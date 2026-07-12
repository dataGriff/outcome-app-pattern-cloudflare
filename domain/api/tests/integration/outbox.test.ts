/** Integration: mutation → todo row + outbox row → relay publishes → row marked.
 *
 * Proves the transactional-outbox path against real (local) D1 and the relay
 * Durable Object, across a multi-type outbox (create + complete + delete in
 * one drain). The test drives the relay explicitly (the deployed smoke covers
 * the waitUntil poke wiring); the alarm test covers the backstop and pruning.
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

async function create(title: string): Promise<{ id: string }> {
  const resp = await SELF.fetch("http://api/todos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  expect(resp.status).toBe(201);
  return (await resp.json()) as { id: string };
}

describe("transactional outbox", () => {
  it("mutations write todo and outbox rows atomically, and the relay drains all types", async () => {
    const todo = await create("outbox roundtrip");
    await SELF.fetch(`http://api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    await SELF.fetch(`http://api/todos/${todo.id}`, { method: "DELETE" });

    expect(await count("SELECT count(*) AS n FROM todos")).toBe(0);
    const { results } = await env.OPERATIONAL_STORE
      .prepare("SELECT subject FROM outbox ORDER BY rowid")
      .all<{ subject: string }>();
    expect(results.map((r) => r.subject)).toEqual([
      "todo.created",
      "todo.completed",
      "todo.deleted",
    ]);

    await relayStub().poke();

    const unpublished = await count(
      "SELECT count(*) AS n FROM outbox WHERE published_at IS NULL",
    );
    const published = await count(
      "SELECT count(*) AS n FROM outbox WHERE published_at IS NOT NULL",
    );
    expect(unpublished).toBe(0);
    expect(published).toBe(3);
  });

  it("the alarm backstop prunes published rows past retention", async () => {
    const old = new Date(Date.now() - 7_200_000).toISOString();
    await env.OPERATIONAL_STORE
      .prepare(
        "INSERT INTO outbox (id, subject, payload, created_at, published_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), "todo.created", "{}", old, old)
      .run();

    const stub = relayStub();
    await stub.poke(); // arms the alarm (nothing unpublished to drain)
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    expect(await count("SELECT count(*) AS n FROM outbox")).toBe(0);
  });
});
