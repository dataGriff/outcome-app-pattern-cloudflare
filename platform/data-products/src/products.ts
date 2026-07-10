/** The analytical read surface: both data products served back as JSON rows
 * for the visualisation (and anything else that wants them over HTTP).
 * Operational/analytical split, demonstrated: these reads come from object
 * storage, never from the domain's operational store.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { parquetReadObjects } from "hyparquet";
import type { Env } from "./env";
import {
  listPerformanceKeys,
  readRecentOperational,
  summariseOnce,
  type PerformanceRow,
} from "./summariser";

export const app = new Hono<{ Bindings: Env }>();
app.use("*", cors());

app.get("/products/colour-operational", async (c) => {
  // Bounded to the recent partitions — the operational awareness view, not the
  // whole system-of-record archive.
  const rows = await readRecentOperational(c.env);
  rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return c.json(rows);
});

app.get("/products/colour-performance", async (c) => {
  // The curated product is partitioned per day; concatenate the per-day Parquets.
  const rows: PerformanceRow[] = [];
  for (const key of await listPerformanceKeys(c.env)) {
    const object = await c.env.OBJECT_STORAGE.get(key);
    if (object === null) continue;
    const buffer = await object.arrayBuffer();
    const file = {
      byteLength: buffer.byteLength,
      slice: async (start: number, end?: number) => buffer.slice(start, end),
    };
    for (const r of (await parquetReadObjects({ file })) as PerformanceRow[]) {
      rows.push({ ...r, count: Number(r.count) });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.colour.localeCompare(b.colour));
  return c.json(rows);
});

app.post("/run/summarise", async (c) => {
  const rows = await summariseOnce(c.env);
  return c.json({ rows });
});
