import type { Env } from "./env";

const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Verify a Turnstile token against Cloudflare's siteverify endpoint. Only
 * called when TURNSTILE_SECRET is configured; keeps casual bots off the public
 * web UI before a request ever reaches the behaviour API. */
async function turnstilePassed(token: string | null, ip: string | null, secret: string): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const resp = await fetch(TURNSTILE_VERIFY, { method: "POST", body: form });
  const outcome = (await resp.json()) as { success?: boolean };
  return outcome.success === true;
}

/** Same-origin proxy to the behaviour API. Everything else is served from
 * static assets (run_worker_first routes only /api/* here). The browser POSTs
 * and subscribes same-origin; this worker forwards to the domain API over the
 * service binding — the web equivalent of the source repo's Flask proxy, now
 * covering the SSE feed too so no channel needs CORS. */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/colours" && request.method === "POST") {
      // Human-challenge the write when Turnstile is provisioned; inert otherwise.
      if (env.TURNSTILE_SECRET) {
        const token = request.headers.get("cf-turnstile-response");
        const ip = request.headers.get("cf-connecting-ip");
        if (!(await turnstilePassed(token, ip, env.TURNSTILE_SECRET))) {
          return Response.json({ detail: "turnstile verification failed" }, { status: 403 });
        }
      }
      return env.DOMAIN_API.fetch("https://behaviour-service/colours", { method: "POST" });
    }

    if (url.pathname === "/api/events/stream" && request.method === "GET") {
      // The service binding streams the text/event-stream body straight through.
      return env.DOMAIN_API.fetch("https://behaviour-service/events/stream");
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
