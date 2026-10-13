/**
 * MustPlay Worker.
 *
 *   GET  /health
 *   POST /v4/<endpoint>   IGDB proxy (Apicalypse body)            — see igdb.ts
 *   POST /agent           Scout agent, server-sent events          — see agent.ts
 *
 * All POST routes accept an optional X-App-Key that must match the APP_KEY secret when set.
 */
import { Env, HttpError, corsHeaders, json, text } from "./env";
import * as igdb from "./igdb";
import * as agent from "./agent";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") return json({ ok: true, qloo: !!env.QLOO_API_KEY, llm: env.LLM_PROVIDER });

    if (env.APP_KEY && request.headers.get("X-App-Key") !== env.APP_KEY) return text(401, "Unauthorized");

    if (path.startsWith("/v4/")) return igdb.handleProxy(request, env, ctx, path.slice("/v4/".length));

    // Raw passthrough to Qloo for debugging response shapes (app-key protected, GET only).
    if (path.startsWith("/qloo/") && request.method === "GET") {
      if (!env.QLOO_API_KEY) return text(503, "QLOO_API_KEY not set");
      const upstream = new URL(path.slice("/qloo".length) + url.search, env.QLOO_BASE_URL);
      const res = await fetch(upstream, { headers: { "X-Api-Key": env.QLOO_API_KEY, Accept: "application/json" } });
      return new Response(await res.text(), { status: res.status, headers: corsHeaders({ "Content-Type": "application/json" }) });
    }

    if (path === "/agent" && request.method === "POST") {
      let body: agent.AgentRequest;
      try {
        body = (await request.json()) as agent.AgentRequest;
      } catch {
        return text(400, "Invalid JSON");
      }
      if (!Array.isArray(body.messages) || !Array.isArray(body.library)) return text(400, "messages and library are required");
      if (body.library.length > 200) body.library = body.library.slice(0, 200);

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const emit = async (event: agent.AgentEvent) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      ctx.waitUntil((async () => {
        try {
          await agent.run(env, body, ctx, emit);
        } catch (error) {
          const raw = error instanceof HttpError ? `${error.message}: ${String(error.detail ?? "")}` : String(error);
          // Stable, app-readable prefixes; the raw detail follows for curl users and logs.
          const code = /4006|daily free allocation|neurons/i.test(raw) ? "llm_quota" : /^AiError|workers ai|llm /i.test(raw) ? "llm" : /qloo/i.test(raw) ? "qloo" : "server";
          console.error("agent failed", raw.slice(0, 500));
          await emit({ type: "error", text: `${code}: ${raw.slice(0, 280)}` });
        } finally {
          await emit({ type: "done" });
          await writer.close();
        }
      })());
      return new Response(readable, {
        headers: corsHeaders({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }),
      });
    }

    return text(404, "Not found");
  },
} satisfies ExportedHandler<Env>;
