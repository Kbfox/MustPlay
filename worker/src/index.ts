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
          const detail = error instanceof HttpError ? `${error.message}: ${String(error.detail ?? "")}` : String(error);
          await emit({ type: "error", text: detail.slice(0, 300) });
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
