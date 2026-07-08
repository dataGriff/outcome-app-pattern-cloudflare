/** Daily summariser: roll the colour-operational events up into the
 * colour-performance curated data product.
 *
 * Reads the flat JSONL operational product, groups by day + colour, counts,
 * and writes Parquet (the curated analytical format). Full recompute →
 * overwrite a single object; deterministic and fine at demo scale. This is
 * the routine batch rollup most apps need, made explicit — a faithful port of
 * the source repo's summarise_daily.py.
 */
import { parquetWriteBuffer } from "hyparquet-writer";
import { OPERATIONAL_PREFIX } from "./consumer";
import type { Env } from "./env";

export const PERFORMANCE_KEY = "colour-performance/colour-performance.parquet";

interface OperationalRow {
  colour: string;
  timestamp: string;
}

export interface PerformanceRow {
  date: string;
  colour: string;
  count: number;
}

export async function readOperational(env: Env): Promise<OperationalRow[]> {
  const rows: OperationalRow[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.OBJECT_STORAGE.list({ prefix: OPERATIONAL_PREFIX, cursor });
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

export async function summariseOnce(env: Env): Promise<number> {
  const raw = await readOperational(env);
  if (raw.length === 0) {
    console.log("No raw events yet; nothing to summarise.");
    return 0;
  }

  const counts = new Map<string, number>();
  for (const row of raw) {
    const key = `${row.timestamp.slice(0, 10)}|${row.colour}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const agg: PerformanceRow[] = [...counts.entries()]
    .map(([key, count]) => {
      const [date, colour] = key.split("|");
      return { date, colour, count };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.colour.localeCompare(b.colour));

  const buffer = parquetWriteBuffer({
    columnData: [
      { name: "date", data: agg.map((r) => r.date), type: "STRING" },
      { name: "colour", data: agg.map((r) => r.colour), type: "STRING" },
      { name: "count", data: agg.map((r) => r.count), type: "INT32" },
    ],
  });
  await env.OBJECT_STORAGE.put(PERFORMANCE_KEY, buffer);
  console.log(`Wrote ${agg.length} aggregate row(s) to ${PERFORMANCE_KEY}`);
  return agg.length;
}
