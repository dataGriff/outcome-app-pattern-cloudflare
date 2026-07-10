import type { Context, Next } from "hono";
import type { Env } from "./env";

/** Guards the one write endpoint against abuse that would drive R2 writes and
 * storage cost. Two native rate limiters: per-client-IP catches a single
 * flooder; the global cap is the wallet ceiling against distributed abuse.
 *
 * Enforced only when RATE_LIMIT === "on" and the bindings are present, so the
 * hermetic dev/test gates (which override RATE_LIMIT to "off") are never
 * throttled. Returns a contract-documented 429 with Retry-After when either
 * limiter trips. */
export async function rateLimit(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const { RATE_LIMIT, RL_PER_IP, RL_GLOBAL } = c.env;
  if (RATE_LIMIT === "on" && RL_PER_IP && RL_GLOBAL) {
    // Per-IP guards the directly-reachable public endpoint: Cloudflare sets
    // cf-connecting-ip on external requests and a caller can't spoof it. The
    // first-party web/agent channels reach us over a service binding with no
    // client IP — they skip per-IP bucketing (so their users aren't throttled
    // collectively) but still count against the global cap. An attacker can't
    // take the no-IP path: service bindings aren't publicly invocable.
    const ip = c.req.header("cf-connecting-ip");
    const results = await Promise.all([
      RL_GLOBAL.limit({ key: "colours" }),
      ...(ip ? [RL_PER_IP.limit({ key: ip })] : []),
    ]);
    if (results.some((r) => !r.success)) {
      return c.json({ detail: "rate limited" }, 429, { "Retry-After": "60" });
    }
  }
  await next();
}
