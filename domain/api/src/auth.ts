import { type AccessIdentity, verifyAccessJwt } from "@colour/access-jwt";
import type { Context, Next } from "hono";
import type { Env } from "./env";

/** Requires a valid Cloudflare Access identity on the write endpoint. Access is
 * the identity provider; this only validates the JWT it issued — against
 * Access's public JWKS, in-process, because callers reach us over a service
 * binding that bypasses the edge, so the edge can't have checked it.
 *
 * Trust model mirrors rateLimit's: a direct external caller sets an unspoofable
 * cf-connecting-ip and must present an Access token (a user JWT, or a service
 * token Access exchanges for one). The first-party web/agent channels reach us
 * over a service binding — no client IP, and not publicly invocable — so they're
 * trusted transport; the web channel additionally forwards the user's JWT so we
 * still learn who is calling. A present-but-invalid token is always rejected.
 *
 * Config-gated like rateLimit/Turnstile: with ACCESS_AUD unset the verifier
 * returns `disabled` and the endpoint stays open, so the hermetic gates and
 * local dev need no tokens. Set ACCESS_TEAM_DOMAIN + ACCESS_AUD to enforce. */
export async function requireAuth(
  c: Context<{ Bindings: Env; Variables: { identity?: AccessIdentity } }>,
  next: Next,
): Promise<Response | void> {
  const result = await verifyAccessJwt(c.req.raw, {
    teamDomain: c.env.ACCESS_TEAM_DOMAIN,
    aud: c.env.ACCESS_AUD,
  });
  if (result.status === "ok") c.set("identity", result.identity);
  if (result.status === "unauthorized") {
    const direct = c.req.header("cf-connecting-ip");
    if (result.reason === "invalid access token" || direct) {
      return c.json({ detail: "unauthorized" }, 401);
    }
  }
  await next();
}
