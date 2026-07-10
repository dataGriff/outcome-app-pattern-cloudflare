/** Hermetic coverage of the rate-limit middleware, isolated from the real
 * bindings: a tiny Hono app wired exactly like the route, driven with stub
 * limiters and an explicit env. Keeps the abuse-guard logic tested without
 * throttling the SELF-based suites (which run with RATE_LIMIT off). */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env, RateLimiter } from "../../src/env";
import { rateLimit } from "../../src/ratelimit";

const pass: RateLimiter = { limit: async () => ({ success: true }) };
const block: RateLimiter = { limit: async () => ({ success: false }) };

async function post(env: Partial<Env>, headers?: Record<string, string>): Promise<Response> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/colours", rateLimit, (c) => c.json({ colour: "red", timestamp: "t" }));
  return app.request("/colours", { method: "POST", headers }, env as Env);
}

const directIp = { "cf-connecting-ip": "203.0.113.7" };

describe("rate limiting POST /colours", () => {
  it("allows a direct request when both limiters pass", async () => {
    const resp = await post({ RATE_LIMIT: "on", RL_PER_IP: pass, RL_GLOBAL: pass }, directIp);
    expect(resp.status).toBe(200);
  });

  it("429s (with Retry-After) when the per-IP limiter trips for a direct caller", async () => {
    const resp = await post({ RATE_LIMIT: "on", RL_PER_IP: block, RL_GLOBAL: pass }, directIp);
    expect(resp.status).toBe(429);
    expect(resp.headers.get("retry-after")).toBe("60");
    expect(await resp.json()).toEqual({ detail: "rate limited" });
  });

  it("429s when the global limiter trips", async () => {
    const resp = await post({ RATE_LIMIT: "on", RL_PER_IP: pass, RL_GLOBAL: block }, directIp);
    expect(resp.status).toBe(429);
  });

  it("skips limiting entirely when RATE_LIMIT is not 'on'", async () => {
    const resp = await post({ RATE_LIMIT: "off", RL_PER_IP: block, RL_GLOBAL: block }, directIp);
    expect(resp.status).toBe(200);
  });

  it("keys the per-IP limiter on cf-connecting-ip", async () => {
    let seen = "";
    const spy: RateLimiter = {
      limit: async ({ key }) => {
        seen = key;
        return { success: true };
      },
    };
    await post({ RATE_LIMIT: "on", RL_PER_IP: spy, RL_GLOBAL: pass }, directIp);
    expect(seen).toBe("203.0.113.7");
  });

  it("skips the per-IP limiter for first-party traffic with no client IP (service binding)", async () => {
    // Web/agent proxy over a service binding — no cf-connecting-ip. Per-IP would
    // block, but it must be skipped so those channels aren't throttled together.
    const resp = await post({ RATE_LIMIT: "on", RL_PER_IP: block, RL_GLOBAL: pass });
    expect(resp.status).toBe(200);
  });

  it("still enforces the global cap on first-party traffic", async () => {
    const resp = await post({ RATE_LIMIT: "on", RL_PER_IP: pass, RL_GLOBAL: block });
    expect(resp.status).toBe(429);
  });
});
