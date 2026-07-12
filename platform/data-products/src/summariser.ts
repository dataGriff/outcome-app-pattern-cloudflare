/** Incremental summariser: roll the todo-operational events up into the
 * todo-performance curated data product, one day at a time.
 *
 * The raw todo-operational log is the durable system of record — immutable,
 * date-partitioned (dt=YYYY-MM-DD), kept forever. Rather than re-scan the whole
 * archive every run (the source repo's summarise_daily.py full recompute), this
 * reads only the *open window* (today + a grace day) and seals each closed day
 * exactly once: aggregate → per-day Parquet → compact its raw fragments →
 * advance a watermark. Sealed days are never listed or read again.
 */
import { parquetWriteBuffer } from "hyparquet-writer";
import { OPERATIONAL_PREFIX, partitionPrefix } from "./consumer";
import type { Env } from "./env";

export const PERFORMANCE_PREFIX = "todo-performance/";
export const WATERMARK_KEY = "_state/summariser.json";
const COMPACTED_NAME = "part-0000.jsonl";
const DEFAULT_OPEN_DAYS = 2;

interface OperationalRow {
  event_type: string;
  todo_id: string;
  user_id: string;
  timestamp: string;
  channel: string;
  is_test: boolean;
}

export interface PerformanceRow {
  date: string;
  event_type: string;
  channel: string;
  is_test: boolean;
  count: number;
}

/** The silver key for a day's curated Parquet (partitioned dt=YYYY-MM-DD). */
export function performanceKey(day: string): string {
  return `${PERFORMANCE_PREFIX}dt=${day}/part.parquet`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The dt= partition dates present in the raw product, sorted ascending. */
export async function listPartitionDates(env: Env): Promise<string[]> {
  const dates: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.OBJECT_STORAGE.list({
      prefix: OPERATIONAL_PREFIX,
      delimiter: "/",
      cursor,
    });
    for (const prefix of listed.delimitedPrefixes) {
      const m = prefix.match(/dt=(\d{4}-\d{2}-\d{2})\/$/);
      if (m) dates.push(m[1]);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return dates.sort();
}

/** Read every JSONL record in one day's raw partition. */
export async function readDay(env: Env, day: string): Promise<OperationalRow[]> {
  const rows: OperationalRow[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.OBJECT_STORAGE.list({ prefix: partitionPrefix(day), cursor });
    for (const obj of listed.objects) {
      if (!obj.key.endsWith(".jsonl")) continue;
      const body = await env.OBJECT_STORAGE.get(obj.key);
      if (body === null) continue;
      for (const line of (await body.text()).split("\n")) {
        if (line.trim()) rows.push(JSON.parse(line) as OperationalRow);
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return rows;
}

function aggregateDay(day: string, rows: OperationalRow[]): PerformanceRow[] {
  // One count per (event_type, channel, is_test) — the dimensions consumers
  // slice by: real usage per channel, test volume kept separate.
  const counts = new Map<string, PerformanceRow>();
  for (const row of rows) {
    const key = `${row.event_type} ${row.channel} ${row.is_test}`;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else {
      counts.set(key, {
        date: day,
        event_type: row.event_type,
        channel: row.channel,
        is_test: row.is_test,
        count: 1,
      });
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.event_type.localeCompare(b.event_type) ||
      a.channel.localeCompare(b.channel) ||
      Number(a.is_test) - Number(b.is_test),
  );
}

async function writeDayParquet(env: Env, day: string, agg: PerformanceRow[]): Promise<void> {
  if (agg.length === 0) return;
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: "date", data: agg.map((r) => r.date), type: "STRING" },
      { name: "event_type", data: agg.map((r) => r.event_type), type: "STRING" },
      { name: "channel", data: agg.map((r) => r.channel), type: "STRING" },
      { name: "is_test", data: agg.map((r) => r.is_test), type: "BOOLEAN" },
      { name: "count", data: agg.map((r) => r.count), type: "INT32" },
    ],
  });
  await env.OBJECT_STORAGE.put(performanceKey(day), buffer);
}

/** Merge a sealed day's many small JSONL fragments into one file, keeping all
 * data. Write the compacted file, then delete the fragments it replaced. */
async function compactDay(env: Env, day: string): Promise<void> {
  const prefix = partitionPrefix(day);
  const compactedKey = `${prefix}${COMPACTED_NAME}`;
  const fragments: string[] = [];
  const lines: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.OBJECT_STORAGE.list({ prefix, cursor });
    for (const obj of listed.objects) {
      if (obj.key === compactedKey || !obj.key.endsWith(".jsonl")) continue;
      const body = await env.OBJECT_STORAGE.get(obj.key);
      if (body === null) continue;
      for (const line of (await body.text()).split("\n")) {
        if (line.trim()) lines.push(line);
      }
      fragments.push(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);

  if (fragments.length === 0) return; // already compacted
  await env.OBJECT_STORAGE.put(compactedKey, `${lines.join("\n")}\n`, {
    httpMetadata: { contentType: "application/json" },
  });
  await env.OBJECT_STORAGE.delete(fragments);
}

async function readWatermark(env: Env): Promise<string | null> {
  const object = await env.OBJECT_STORAGE.get(WATERMARK_KEY);
  if (object === null) return null;
  return (JSON.parse(await object.text()) as { sealedThrough: string | null }).sealedThrough;
}

async function writeWatermark(env: Env, sealedThrough: string): Promise<void> {
  await env.OBJECT_STORAGE.put(WATERMARK_KEY, JSON.stringify({ sealedThrough }), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function summariseOnce(env: Env): Promise<number> {
  const openDays = Number(env.SUMMARISER_OPEN_DAYS ?? "") || DEFAULT_OPEN_DAYS;
  const openFrom = addDays(today(), -(openDays - 1)); // inclusive earliest open date
  const partitions = await listPartitionDates(env);
  let sealedThrough = await readWatermark(env);
  let total = 0;

  // Seal each closed day exactly once: read raw, write its Parquet, compact its
  // fragments, advance the watermark. Partitions are sorted ascending.
  for (const day of partitions) {
    if (day >= openFrom) continue; // still in the open window
    if (sealedThrough !== null && day <= sealedThrough) continue; // already sealed
    const agg = aggregateDay(day, await readDay(env, day));
    await writeDayParquet(env, day, agg);
    await compactDay(env, day);
    sealedThrough = day;
    await writeWatermark(env, day);
    total += agg.length;
  }

  // Recompute the open window from raw each run (bounded to openDays, not history).
  for (const day of partitions) {
    if (day < openFrom) continue;
    const agg = aggregateDay(day, await readDay(env, day));
    await writeDayParquet(env, day, agg);
    total += agg.length;
  }

  if (total === 0) console.log("No raw events yet; nothing to summarise.");
  return total;
}

/** Read only the most recent partitions of the raw product — the operational
 * "what's happening now" view. Full history stays in R2 for occasional audit,
 * but is never the hot read path. */
export async function readRecentOperational(
  env: Env,
  days = DEFAULT_OPEN_DAYS,
): Promise<OperationalRow[]> {
  const from = addDays(today(), -(days - 1));
  const rows: OperationalRow[] = [];
  for (const day of await listPartitionDates(env)) {
    if (day >= from) rows.push(...(await readDay(env, day)));
  }
  return rows;
}

/** Read the whole curated product back (all per-day Parquets concatenated). */
export async function listPerformanceKeys(env: Env): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.OBJECT_STORAGE.list({ prefix: PERFORMANCE_PREFIX, cursor });
    for (const obj of listed.objects) {
      if (obj.key.endsWith(".parquet")) keys.push(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);
  return keys.sort();
}
