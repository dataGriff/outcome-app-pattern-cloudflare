/** Structural verification of both data products against their contracts —
 * the hermetic pre-deploy layer. The real `datacontract test` runs post-deploy
 * against R2's S3 API in CI (local R2 has no S3 endpoint).
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
  it("the consumer lands JSONL records matching the contract model", async () => {
    await deliver([
      event("red", "2026-07-08T10:00:00.000Z"),
      event("green", "2026-07-08T10:01:00.000Z"),
    ]);

    const listed = await env.OBJECT_STORAGE.list({ prefix: "colour-operational/" });
    expect(listed.objects).toHaveLength(1);
    expect(listed.objects[0].key).toMatch(/\.jsonl$/);

    const body = await (await env.OBJECT_STORAGE.get(listed.objects[0].key))!.text();
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
});

describe("colour-performance product", () => {
  it("the summariser writes a Parquet aggregate matching the contract model", async () => {
    await deliver([
      event("red", "2026-07-07T09:00:00.000Z"),
      event("red", "2026-07-07T10:00:00.000Z"),
      event("green", "2026-07-08T09:00:00.000Z"),
    ]);

    const run = await SELF.fetch("http://products/run/summarise", { method: "POST" });
    expect(run.status).toBe(200);
    expect(((await run.json()) as { rows: number }).rows).toBe(2);

    expect(await env.OBJECT_STORAGE.head("colour-performance/colour-performance.parquet")).not.toBeNull();

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
});

describe("products read surface", () => {
  it("serves the operational product most recent first", async () => {
    await deliver([
      event("amber", "2026-07-08T10:00:00.000Z"),
      event("red", "2026-07-08T11:00:00.000Z"),
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
