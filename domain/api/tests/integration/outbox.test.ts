/** Integration: POST → colours row + outbox row → relay publishes → row marked.
 *
 * Proves the transactional-outbox path against real (local) D1 and the relay
 * Durable Object. The test drives the relay explicitly (the deployed smoke
 * covers the waitUntil poke wiring); the alarm test covers the backstop and
 * pruning.
 */
import { env, runDurableObjectAlarm, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function count(sql: string): Promise<number> {
  const row = await env.OPERATIONAL_STORE.prepare(sql).first<{ n: number }>();
  return row?.n ?? 0;
}

function relayStub() {
  return env.OUTBOX_RELAY.get(env.OUTBOX_RELAY.idFromName("relay"));
}

describe("transactional outbox", () => {
  it("POST writes the colour and outbox rows atomically, and the relay drains", async () => {
    const before = await count("SELECT count(*) AS n FROM colours");
    const resp = await SELF.fetch("http://api/colours", { method: "POST" });
    expect(resp.status).toBe(200);

    expect(await count("SELECT count(*) AS n FROM colours")).toBe(before + 1);
    expect(await count("SELECT count(*) AS n FROM outbox")).toBeGreaterThan(0);

    await relayStub().poke();

    const unpublished = await count(
      "SELECT count(*) AS n FROM outbox WHERE published_at IS NULL",
    );
    const published = await count(
      "SELECT count(*) AS n FROM outbox WHERE published_at IS NOT NULL",
    );
    expect(unpublished).toBe(0);
    expect(published).toBeGreaterThan(0);
  });

  it("the alarm backstop prunes published rows past retention", async () => {
    const old = new Date(Date.now() - 7_200_000).toISOString();
    await env.OPERATIONAL_STORE
      .prepare(
        "INSERT INTO outbox (id, subject, payload, created_at, published_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), "colour.generated", "{}", old, old)
      .run();

    const stub = relayStub();
    await stub.poke(); // arms the alarm (nothing unpublished to drain)
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    expect(await count("SELECT count(*) AS n FROM outbox")).toBe(0);
  });
});
