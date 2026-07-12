/** Per-user SSE routing: the relay must deliver each event only to its
 * owner's StreamDO — isolation by construction, no cross-user filter to get
 * wrong. Two users' streams are opened, a mixed-user outbox is drained, and
 * each stream must carry exactly its owner's frames.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildTodoEvent, type TodoEvent } from "../../src/event";

interface Frame {
  type: string;
  data: { todo_id: string; user_id: string };
}

async function openStream(user: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const stub = env.STREAM.get(env.STREAM.idFromName(user));
  const resp = await stub.fetch("http://stream/");
  expect(resp.headers.get("content-type")).toBe("text/event-stream");
  return resp.body!.getReader();
}

/** Read SSE data frames until `n` arrive or the timeout elapses (returning
 * whatever arrived — the caller asserts, so a routing bug fails loudly). */
async function readFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
  timeoutMs = 2_000,
): Promise<Frame[]> {
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (frames.length < n && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
    ]);
    if (chunk === null || chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (raw.startsWith("data: ")) frames.push(JSON.parse(raw.slice(6)) as Frame);
      idx = buffer.indexOf("\n\n");
    }
  }
  return frames;
}

async function seedOutbox(event: TodoEvent): Promise<void> {
  await env.OPERATIONAL_STORE
    .prepare("INSERT INTO outbox (id, subject, payload, created_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), event.type, JSON.stringify(event), event.time)
    .run();
}

describe("per-user stream routing", () => {
  it("each user's stream carries only their own events", async () => {
    const aliceReader = await openStream("alice");
    const bobReader = await openStream("bob");

    const ts = new Date().toISOString();
    const aliceCreated = buildTodoEvent("todo.created", {
      todo_id: crypto.randomUUID(),
      user_id: "alice",
      title: "alice's todo",
      completed: false,
      timestamp: ts,
    });
    const aliceCompleted = buildTodoEvent("todo.completed", {
      todo_id: aliceCreated.data.todo_id,
      user_id: "alice",
      title: "alice's todo",
      completed: true,
      timestamp: ts,
    });
    const bobCreated = buildTodoEvent("todo.created", {
      todo_id: crypto.randomUUID(),
      user_id: "bob",
      title: "bob's todo",
      completed: false,
      timestamp: ts,
    });
    await seedOutbox(aliceCreated);
    await seedOutbox(bobCreated);
    await seedOutbox(aliceCompleted);

    await env.OUTBOX_RELAY.get(env.OUTBOX_RELAY.idFromName("relay")).poke();

    const aliceFrames = await readFrames(aliceReader, 2);
    expect(aliceFrames.map((f) => f.type)).toEqual(["todo.created", "todo.completed"]);
    for (const f of aliceFrames) expect(f.data.user_id).toBe("alice");

    const bobFrames = await readFrames(bobReader, 1);
    expect(bobFrames).toHaveLength(1);
    expect(bobFrames[0].data.user_id).toBe("bob");
    expect(bobFrames[0].data.todo_id).toBe(bobCreated.data.todo_id);

    // Nothing else should arrive on bob's stream — a short extra read must
    // come back empty, or alice's events leaked.
    expect(await readFrames(bobReader, 1, 300)).toHaveLength(0);

    await aliceReader.cancel();
    await bobReader.cancel();
  });
});
