import { verifyAccessJwt } from "@todo/access-jwt";
import type { Env } from "./env";

const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const ACCESS_HEADER = "cf-access-jwt-assertion";

/** Forward the caller's Access JWT to the domain over the service binding, so
 * the domain knows who is calling. Service-binding traffic bypasses the edge,
 * so the domain can only learn identity from this forwarded header — on every
 * call, including the SSE stream (the per-user feed is useless without it).
 * Content-Type rides along for the JSON write bodies. */
function forwardedHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {};
  const token = request.headers.get(ACCESS_HEADER);
  if (token) headers[ACCESS_HEADER] = token;
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  return headers;
}

/** Verify a Turnstile token against Cloudflare's siteverify endpoint. Only
 * called when TURNSTILE_SECRET is configured; keeps casual bots off the public
 * web UI before a request ever reaches the todo API. */
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

/** Same-origin proxy to the todo API. Everything else is served from static
 * assets (run_worker_first routes only /api/* here). The browser calls
 * same-origin; this worker forwards method, path, query and body to the domain
 * API over the service binding — the web equivalent of the source repo's Flask
 * proxy, covering the SSE feed too so no channel needs CORS. */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("not found", { status: 404 });
    }

    // Validate the Access JWT here too (defence in depth) — the edge should have
    // already, but a valid identity is required before we act. Inert when Access
    // is unprovisioned. Applies to the whole /api surface.
    const auth = await verifyAccessJwt(request, {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
    });
    if (auth.status === "unauthorized") {
      return Response.json({ detail: "unauthorized" }, { status: 401 });
    }

    if (url.pathname === "/api/todos" && request.method === "POST" && env.TURNSTILE_SECRET) {
      // Human-challenge the create when Turnstile is provisioned; inert otherwise.
      const token = request.headers.get("cf-turnstile-response");
      const ip = request.headers.get("cf-connecting-ip");
      if (!(await turnstilePassed(token, ip, env.TURNSTILE_SECRET))) {
        return Response.json({ detail: "turnstile verification failed" }, { status: 403 });
      }
    }

    // Strip the /api prefix and pass everything else through. The domain owns
    // routing and validation — an unknown path 404s there, not here.
    const target = `https://behaviour-service${url.pathname.slice(4)}${url.search}`;
    return env.DOMAIN_API.fetch(target, {
      method: request.method,
      headers: forwardedHeaders(request),
      body: request.body,
    });
  },
} satisfies ExportedHandler<Env>;
