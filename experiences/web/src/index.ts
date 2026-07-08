import type { Env } from "./env";

/** Same-origin proxy to the behaviour API. Everything else is served from
 * static assets (run_worker_first routes only /api/* here). The browser POSTs
 * and subscribes same-origin; this worker forwards to the domain API over the
 * service binding — the web equivalent of the source repo's Flask proxy, now
 * covering the SSE feed too so no channel needs CORS. */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/colours" && request.method === "POST") {
      return env.DOMAIN_API.fetch("https://behaviour-service/colours", { method: "POST" });
    }

    if (url.pathname === "/api/events/stream" && request.method === "GET") {
      // The service binding streams the text/event-stream body straight through.
      return env.DOMAIN_API.fetch("https://behaviour-service/events/stream");
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
