import type { OutboxRelayDO } from "./relay";
import type { StreamDO } from "./stream";

/** The native Workers Rate Limiting binding surface (one method). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  OPERATIONAL_STORE: D1Database;
  EVENTS: Queue;
  OUTBOX_RELAY: DurableObjectNamespace<OutboxRelayDO>;
  STREAM: DurableObjectNamespace<StreamDO>;
  OUTBOX_RETENTION_SECONDS?: string;
  // "on" enforces rate limiting; anything else (dev/test) skips it.
  RATE_LIMIT?: string;
  // Present only when RATE_LIMIT is enforced (declared in wrangler.jsonc).
  RL_PER_IP?: RateLimiter;
  RL_GLOBAL?: RateLimiter;
}
