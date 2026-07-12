/** The analytical read surface: both data products served back as JSON rows
 * for the visualisation (and anything else that wants them over HTTP).
 * Operational/analytical split, demonstrated: these reads come from object
 * storage, never from the domain's operational store.
 */
import { verifyAccessJwt } from "@todo/access-jwt";
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

// Gate the read surface behind Cloudflare Access when provisioned. The Worker
// validates the injected/forwarded JWT in-process (defence in depth); inert
// while ACCESS_AUD is unset, so the demo and hermetic tests stay open. Guards
// the visualisation page, /products/*, and the /run/summarise trigger.
app.use("*", async (c, next) => {
  const auth = await verifyAccessJwt(c.req.raw, {
    teamDomain: c.env.ACCESS_TEAM_DOMAIN,
    aud: c.env.ACCESS_AUD,
  });
  if (auth.status === "unauthorized") {
    return c.json({ detail: "unauthorized" }, 401);
  }
  await next();
});

app.get("/products/todo-operational", async (c) => {
  // Bounded to the recent partitions — the operational awareness view, not the
  // whole system-of-record archive.
  const rows = await readRecentOperational(c.env);
  rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return c.json(rows);
});

app.get("/products/todo-performance", async (c) => {
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
  // Null-safe on channel: Parquet written before the channel/is_test schema
  // evolution can carry nulls — a read surface must not 500 on old data.
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.event_type.localeCompare(b.event_type) ||
      (a.channel ?? "").localeCompare(b.channel ?? "") ||
      Number(a.is_test) - Number(b.is_test),
  );
  return c.json(rows);
});

app.post("/run/summarise", async (c) => {
  const rows = await summariseOnce(c.env);
  return c.json({ rows });
});
