/** The streaming role: land todo events as the todo-operational data product
 * (append-only JSONL, transport envelope stripped) — the same mapping the
 * source repo's bento pipeline applied.
 *
 * The landed record is built by explicit field picks, so the todo title (user
 * content, transport-only) can never leak into the 10-year-retention product —
 * the PII bar the data contract declares.
 */
import type { Env, TodoEvent } from "./env";

export const OPERATIONAL_PREFIX = "todo-operational/";

/** The bronze partition prefix for a given event day (Hive-style dt=YYYY-MM-DD). */
export function partitionPrefix(day: string): string {
  return `${OPERATIONAL_PREFIX}dt=${day}/`;
}

export async function consume(
  batch: MessageBatch<TodoEvent>,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<void> {
  // Group the batch by event day so each raw file lands wholly inside one dt=
  // partition (a batch almost always spans a single day; the rare midnight-
  // straddling batch simply splits into two files).
  const linesByDay = new Map<string, string[]>();
  for (const m of batch.messages) {
    const { todo_id, user_id, timestamp, channel, is_test } = m.body.data;
    const day = timestamp.slice(0, 10);
    const lines = linesByDay.get(day) ?? linesByDay.set(day, []).get(day)!;
    lines.push(JSON.stringify({ event_type: m.body.type, todo_id, user_id, timestamp, channel, is_test }));
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
