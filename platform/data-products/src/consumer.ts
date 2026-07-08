/** The streaming role: land colour.generated events as the colour-operational
 * data product (append-only JSONL, transport envelope stripped) — the same
 * mapping the source repo's bento pipeline applied.
 */
import type { ColourGeneratedEvent, Env } from "./env";

export const OPERATIONAL_PREFIX = "colour-operational/";

export async function consume(
  batch: MessageBatch<ColourGeneratedEvent>,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<void> {
  const lines = batch.messages.map((m) =>
    JSON.stringify({ colour: m.body.data.colour, timestamp: m.body.data.timestamp }),
  );
  const key = `${OPERATIONAL_PREFIX}${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jsonl`;
  await env.OBJECT_STORAGE.put(key, `${lines.join("\n")}\n`, {
    httpMetadata: { contentType: "application/json" },
  });
  // Ack only after the put: at-least-once, and the append-only product
  // tolerates the resulting duplicates (documented in the source repo too).
  batch.ackAll();
}
