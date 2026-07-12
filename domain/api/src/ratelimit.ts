import type { AccessIdentity } from "@todo/access-jwt";
import type { Context, Next } from "hono";
import type { Env } from "./env";

/** Guards the write endpoints against abuse that would drive R2 writes and
 * storage cost. Two native rate limiters: per-caller catches a single flooder;
 * the global cap is the wallet ceiling against distributed abuse.
 *
 * Enforced only when RATE_LIMIT === "on" and the bindings are present, so the
 * hermetic dev/test gates (which override RATE_LIMIT to "off") are never
 * throttled. Returns a contract-documented 429 with Retry-After when either
 * limiter trips. */
export async function rateLimit(
  c: Context<{ Bindings: Env; Variables: { identity: AccessIdentity } }>,
  next: Next,
): Promise<Response | void> {
  const { RATE_LIMIT, RL_PER_IP, RL_GLOBAL } = c.env;
  if (RATE_LIMIT === "on" && RL_PER_IP && RL_GLOBAL) {
    // Per-caller bucketing: a direct external request carries an unspoofable
    // cf-connecting-ip. The first-party web/agent channels reach us over a
    // service binding with no client IP — they aren't publicly invocable, and
    // requireAuth has already established who is calling, so their bucket is
    // the authenticated user's sub. Either way one flooder can't spend the
    // global budget alone.
    const key = c.req.header("cf-connecting-ip") ?? c.get("identity")?.sub;
    const results = await Promise.all([
      RL_GLOBAL.limit({ key: "todos" }),
      ...(key ? [RL_PER_IP.limit({ key })] : []),
    ]);
    if (results.some((r) => !r.success)) {
      return c.json({ detail: "rate limited" }, 429, { "Retry-After": "60" });
    }
  }
  await next();
}
