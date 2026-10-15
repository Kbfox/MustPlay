import { Env, HttpError } from "./env";

// Provider-agnostic chat with tools. Default: Cloudflare Workers AI (no key).
// Alternative: any OpenAI-compatible endpoint (DeepSeek, OpenAI, Qwen) via LLM_BASE_URL + LLM_API_KEY.

export type Role = "system" | "user" | "assistant" | "tool";
export interface Message { role: Role; content: string; name?: string; tool_call_id?: string; tool_calls?: ToolCall[] }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ChatResult { content: string; toolCalls: ToolCall[] }

const FALLBACK_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
// In-isolate circuit breaker: after the primary provider fails, use Workers AI for a minute
// instead of paying the retry delay on every turn of every request.
let primaryDownUntil = 0;

export async function chat(env: Env, messages: Message[], tools: ToolSpec[]): Promise<ChatResult> {
  if (env.LLM_PROVIDER !== "openai-compatible") return chatWorkersAI(env, messages, tools, env.LLM_MODEL);
  if (Date.now() < primaryDownUntil) return chatWorkersAI(env, messages, tools, env.LLM_FALLBACK_MODEL || FALLBACK_MODEL);
  let lastError: unknown;
  for (const delay of [0, 800, 2000]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      return await chatOpenAI(env, messages, tools);
    } catch (e) {
      lastError = e;
      const status = e instanceof HttpError ? Number(/-> (\d{3})/.exec(e.message)?.[1]) : 0;
      if (status && !RETRYABLE.has(status)) throw e; // auth or bad request: retrying will not help
    }
  }
  primaryDownUntil = Date.now() + 60_000;
  console.warn("primary LLM unavailable, falling back to Workers AI", String((lastError as Error)?.message ?? lastError));
  return chatWorkersAI(env, messages, tools, env.LLM_FALLBACK_MODEL || FALLBACK_MODEL);
}

function toOpenAITools(tools: ToolSpec[]) {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function toOpenAIMessages(messages: Message[]) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      return { role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) };
    }
    if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, name: m.name, content: m.content };
    return { role: m.role, content: m.content };
  });
}

function parseArgs(a: unknown): Record<string, unknown> {
  if (a && typeof a === "object") return a as Record<string, unknown>;
  if (typeof a === "string") { try { return JSON.parse(a); } catch { return {}; } }
  return {};
}

async function chatWorkersAI(env: Env, messages: Message[], tools: ToolSpec[], model: string): Promise<ChatResult> {
  const out = (await env.AI.run(model as any, {
    messages: toOpenAIMessages(messages),
    tools: toOpenAITools(tools),
    max_tokens: 1200,
  } as any)) as any;
  // Workers AI returns either { response, tool_calls: [{name, arguments}] } or an OpenAI-style object.
  const choice = out?.choices?.[0]?.message;
  const content: string = choice?.content ?? out?.response ?? "";
  const rawCalls: any[] = choice?.tool_calls ?? out?.tool_calls ?? [];
  const toolCalls: ToolCall[] = rawCalls.map((c, i) => ({
    id: c.id ?? `call_${i}`,
    name: c.function?.name ?? c.name,
    arguments: parseArgs(c.function?.arguments ?? c.arguments),
  }));
  return { content: content ?? "", toolCalls };
}

async function chatOpenAI(env: Env, messages: Message[], tools: ToolSpec[]): Promise<ChatResult> {
  const res = await fetch(`${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.LLM_API_KEY ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify({ model: env.LLM_MODEL, messages: toOpenAIMessages(messages), tools: toOpenAITools(tools), tool_choice: "auto" }),
  });
  if (!res.ok) throw new HttpError(502, `llm -> ${res.status}`, await res.text());
  const data = (await res.json()) as any;
  const m = data.choices?.[0]?.message ?? {};
  return {
    content: m.content ?? "",
    toolCalls: (m.tool_calls ?? []).map((c: any, i: number) => ({ id: c.id ?? `call_${i}`, name: c.function.name, arguments: parseArgs(c.function.arguments) })),
  };
}
