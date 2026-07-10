/** Structural verification of both data products against their contracts —
 * the hermetic pre-deploy layer. The real `datacontract test` runs post-deploy
 * against R2's S3 API in CI (local R2 has no S3 endpoint).
 *
 * Also covers the system-of-record tiering: date-partitioned raw, per-day
 * curated Parquet, day-sealing with compaction, and the watermark that keeps
 * sealed days from ever being re-read.
 */
import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { ColourGeneratedEvent } from "../../src/env";
import worker from "../../src/index";

interface ContractModel {
  fields: Record<string, { type: string; enum?: string[] }>;
}

function contractModel(yaml: string, model: string): ContractModel {
  const contract = parse(yaml) as { models: Record<string, ContractModel> };
  return contract.models[model];
}

const today = new Date().toISOString().slice(0, 10);

function event(colour: string, timestamp: string): ColourGeneratedEvent {
  return {
    id: crypto.randomUUID(),
    source: "urn:outcome-app-pattern:behaviour-service",
    specversion: "1.0",
    type: "colour.generated",
    time: timestamp,
    data: { colour, timestamp },
  };
}

async function deliver(events: ColourGeneratedEvent[]): Promise<void> {
  const batch = createMessageBatch<ColourGeneratedEvent>(
    "colour-events",
    events.map((e) => ({ id: crypto.randomUUID(), timestamp: new Date(), attempts: 1, body: e })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  const result = await getQueueResult(batch, ctx);
  expect(result.ackAll).toBe(true);
}

async function keysUnder(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let listed = await env.OBJECT_STORAGE.list({ prefix });
  for (;;) {
    keys.push(...listed.objects.map((o) => o.key));
    if (!listed.truncated) break;
    listed = await env.OBJECT_STORAGE.list({ prefix, cursor: listed.cursor });
  }
  return keys.sort();
}

beforeEach(async () => {
  let listed = await env.OBJECT_STORAGE.list();
  for (;;) {
    if (listed.objects.length > 0) {
      await env.OBJECT_STORAGE.delete(listed.objects.map((o) => o.key));
    }
    if (!listed.truncated) break;
    listed = await env.OBJECT_STORAGE.list({ cursor: listed.cursor });
  }
});

describe("colour-operational product", () => {
  it("the consumer lands JSONL records in a dt= partition, matching the contract", async () => {
    await deliver([
      event("red", "2026-07-08T10:00:00.000Z"),
      event("green", "2026-07-08T10:01:00.000Z"),
    ]);

    const keys = await keysUnder("colour-operational/");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^colour-operational\/dt=2026-07-08\/.*\.jsonl$/);

    const body = await (await env.OBJECT_STORAGE.get(keys[0]))!.text();
    const rows = body
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows).toHaveLength(2);

    const model = contractModel(env.OPERATIONAL_CONTRACT_YAML, "colour_operational");
    for (const row of rows) {
      // Envelope stripped: exactly the contract's fields, nothing more.
      expect(Object.keys(row).sort()).toEqual(Object.keys(model.fields).sort());
      expect(model.fields.colour.enum).toContain(row.colour);
      expect(Number.isNaN(Date.parse(row.timestamp as string))).toBe(false);
    }
  });

  it("events on different days split into separate partitions", async () => {
    await deliver([
      event("red", "2026-07-07T23:59:00.000Z"),
      event("green", "2026-07-08T00:01:00.000Z"),
    ]);
    expect(await keysUnder("colour-operational/dt=2026-07-07/")).toHaveLength(1);
    expect(await keysUnder("colour-operational/dt=2026-07-08/")).toHaveLength(1);
  });
});

describe("colour-performance product", () => {
  it("the summariser writes a per-day Parquet aggregate matching the contract", async () => {
    await deliver([event("red", "2026-07-07T09:00:00.000Z")]);
    await deliver([event("red", "2026-07-07T10:00:00.000Z")]); // second fragment, same day
    await deliver([event("green", "2026-07-08T09:00:00.000Z")]);

    const run = await SELF.fetch("http://products/run/summarise", { method: "POST" });
    expect(run.status).toBe(200);
    expect(((await run.json()) as { rows: number }).rows).toBe(2);

    // Per-day silver Parquet, one file per day.
    expect(await env.OBJECT_STORAGE.head("colour-performance/dt=2026-07-07/part.parquet")).not.toBeNull();
    expect(await env.OBJECT_STORAGE.head("colour-performance/dt=2026-07-08/part.parquet")).not.toBeNull();

    const resp = await SELF.fetch("http://products/products/colour-performance");
    expect(resp.status).toBe(200);
    const rows = (await resp.json()) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);

    const model = contractModel(env.PERFORMANCE_CONTRACT_YAML, "colour_performance");
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(Object.keys(model.fields).sort());
      expect(model.fields.colour.enum).toContain(row.colour);
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(row.count)).toBe(true);
    }
    const red7 = rows.find((r) => r.date === "2026-07-07" && r.colour === "red");
    expect(red7?.count).toBe(2);
  });

  it("sealing a closed day compacts its raw fragments to one file and sets the watermark", async () => {
    await deliver([event("red", "2026-07-07T09:00:00.000Z")]);
    await deliver([event("amber", "2026-07-07T10:00:00.000Z")]);
    expect(await keysUnder("colour-operational/dt=2026-07-07/")).toHaveLength(2);

    await SELF.fetch("http://products/run/summarise", { method: "POST" });

    const raw = await keysUnder("colour-operational/dt=2026-07-07/");
    expect(raw).toEqual(["colour-operational/dt=2026-07-07/part-0000.jsonl"]);
    const compacted = await (await env.OBJECT_STORAGE.get(raw[0]))!.text();
    expect(compacted.split("\n").filter((l) => l.trim())).toHaveLength(2); // no data lost

    const watermark = await (await env.OBJECT_STORAGE.get("_state/summariser.json"))!.json();
    expect(watermark).toEqual({ sealedThrough: "2026-07-07" });
  });

  it("does not re-read a sealed day on the next run (incremental)", async () => {
    await deliver([event("green", "2026-07-07T09:00:00.000Z")]);
    await SELF.fetch("http://products/run/summarise", { method: "POST" });
    expect(await env.OBJECT_STORAGE.head("colour-performance/dt=2026-07-07/part.parquet")).not.toBeNull();

    // Delete the sealed day's curated output, then run again: because the day is
    // at/under the watermark it is skipped, so the Parquet is NOT regenerated.
    await env.OBJECT_STORAGE.delete("colour-performance/dt=2026-07-07/part.parquet");
    const run = await SELF.fetch("http://products/run/summarise", { method: "POST" });
    expect(((await run.json()) as { rows: number }).rows).toBe(0);
    expect(await env.OBJECT_STORAGE.head("colour-performance/dt=2026-07-07/part.parquet")).toBeNull();
  });

  it("keeps today's partition open — recomputed, not compacted, not watermarked", async () => {
    await deliver([event("red", `${today}T09:00:00.000Z`)]);
    await deliver([event("green", `${today}T10:00:00.000Z`)]);

    await SELF.fetch("http://products/run/summarise", { method: "POST" });

    expect(await env.OBJECT_STORAGE.head(`colour-performance/dt=${today}/part.parquet`)).not.toBeNull();
    // Two fragments remain uncompacted (day still open).
    expect(await keysUnder(`colour-operational/dt=${today}/`)).toHaveLength(2);
    // Nothing sealed.
    expect(await env.OBJECT_STORAGE.head("_state/summariser.json")).toBeNull();
  });
});

describe("products read surface", () => {
  it("serves the recent operational window, most recent first", async () => {
    await deliver([
      event("amber", `${today}T10:00:00.000Z`),
      event("red", `${today}T11:00:00.000Z`),
    ]);
    const resp = await SELF.fetch("http://products/products/colour-operational");
    const rows = (await resp.json()) as { colour: string; timestamp: string }[];
    expect(rows.map((r) => r.colour)).toEqual(["red", "amber"]);
  });

  it("serves an empty performance product before the first summarise", async () => {
    const resp = await SELF.fetch("http://products/products/colour-performance");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual([]);
  });
});
