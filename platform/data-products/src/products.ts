/** The analytical read surface: both data products served back as JSON rows
 * for the visualisation (and anything else that wants them over HTTP).
 * Operational/analytical split, demonstrated: these reads come from object
 * storage, never from the domain's operational store.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { parquetReadObjects } from "hyparquet";
import type { Env } from "./env";
import { PERFORMANCE_KEY, readOperational, summariseOnce, type PerformanceRow } from "./summariser";

export const app = new Hono<{ Bindings: Env }>();
app.use("*", cors());

app.get("/products/colour-operational", async (c) => {
  const rows = await readOperational(c.env);
  rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return c.json(rows);
});

app.get("/products/colour-performance", async (c) => {
  const object = await c.env.OBJECT_STORAGE.get(PERFORMANCE_KEY);
  if (object === null) return c.json([]);
  const buffer = await object.arrayBuffer();
  const file = {
    byteLength: buffer.byteLength,
    slice: async (start: number, end?: number) => buffer.slice(start, end),
  };
  const rows = (await parquetReadObjects({ file })) as PerformanceRow[];
  return c.json(rows.map((r) => ({ ...r, count: Number(r.count) })));
});

app.post("/run/summarise", async (c) => {
  const rows = await summariseOnce(c.env);
  return c.json({ rows });
});
