/** The streaming role: land colour.generated events as the colour-operational
 * data product (append-only JSONL, transport envelope stripped) — the same
 * mapping the source repo's bento pipeline applied.
 */
import type { ColourGeneratedEvent, Env } from "./env";

export const OPERATIONAL_PREFIX = "colour-operational/";

/** The bronze partition prefix for a given event day (Hive-style dt=YYYY-MM-DD). */
export function partitionPrefix(day: string): string {
  return `${OPERATIONAL_PREFIX}dt=${day}/`;
}

export async function consume(
  batch: MessageBatch<ColourGeneratedEvent>,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<void> {
  // Group the batch by event day so each raw file lands wholly inside one dt=
  // partition (a batch almost always spans a single day; the rare midnight-
  // straddling batch simply splits into two files).
  const linesByDay = new Map<string, string[]>();
  for (const m of batch.messages) {
    const { colour, timestamp } = m.body.data;
    const day = timestamp.slice(0, 10);
    const lines = linesByDay.get(day) ?? linesByDay.set(day, []).get(day)!;
    lines.push(JSON.stringify({ colour, timestamp }));
  }
  for (const [day, lines] of linesByDay) {
    const key = `${partitionPrefix(day)}${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jsonl`;
    await env.OBJECT_STORAGE.put(key, `${lines.join("\n")}\n`, {
      httpMetadata: { contentType: "application/json" },
    });
  }
  // Ack only after the puts: at-least-once, and the append-only product
  // tolerates the resulting duplicates (documented in the source repo too).
  batch.ackAll();
}
