import type { OutboxRelayDO } from "./relay";
import type { StreamDO } from "./stream";

export interface Env {
  OPERATIONAL_STORE: D1Database;
  EVENTS: Queue;
  OUTBOX_RELAY: DurableObjectNamespace<OutboxRelayDO>;
  STREAM: DurableObjectNamespace<StreamDO>;
  OUTBOX_RETENTION_SECONDS?: string;
}
