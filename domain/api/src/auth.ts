import { DEV_IDENTITY, type AccessIdentity, verifyAccessJwt } from "@todo/access-jwt";
import type { Context, Next } from "hono";
import type { Env } from "./env";

/** Requires a Cloudflare Access identity on every todo endpoint. Access is the
 * identity provider; this only validates the JWT it issued — against Access's
 * public JWKS, in-process, because callers reach us over a service binding
 * that bypasses the edge, so the edge can't have checked it.
 *
 * Per-user data needs an identity on every request, so unlike the colour
 * domain's transport-trust model there is no pass-through: with Access
 * enabled, a missing or invalid token is always 401 — first-party channels
 * must forward the caller's JWT over their service binding.
 *
 * Config-gated like rateLimit/Turnstile: with ACCESS_AUD unset the verifier
 * returns `disabled` and every request acts as the fixed DEV_IDENTITY, so the
 * hermetic gates and local dev need no tokens and still exercise the per-user
 * paths. Set ACCESS_TEAM_DOMAIN + ACCESS_AUD to enforce. */
export async function requireAuth(
  c: Context<{ Bindings: Env; Variables: { identity: AccessIdentity } }>,
  next: Next,
): Promise<Response | void> {
  const result = await verifyAccessJwt(c.req.raw, {
    teamDomain: c.env.ACCESS_TEAM_DOMAIN,
    aud: c.env.ACCESS_AUD,
  });
  if (result.status === "unauthorized") {
    return c.json({ detail: "unauthorized" }, 401);
  }
  c.set("identity", result.status === "ok" ? result.identity : DEV_IDENTITY);
  await next();
}
