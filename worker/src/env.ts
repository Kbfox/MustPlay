export interface Env {
  // IGDB proxy
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  APP_KEY?: string;
  // Scout agent
  AI: Ai;
  LLM_PROVIDER: "workers-ai" | "openai-compatible";
  LLM_MODEL: string;
  LLM_BASE_URL: string;
  LLM_API_KEY?: string;
  LLM_FALLBACK_MODEL?: string;
  QLOO_BASE_URL: string;
  QLOO_API_KEY?: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

export function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
    ...extra,
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

export function text(status: number, message: string): Response {
  return new Response(message, { status, headers: corsHeaders({ "Content-Type": "text/plain" }) });
}
