/** The published event payload must match the AsyncAPI contract.
 *
 * The outbox row's payload IS the message the relay publishes byte-for-byte,
 * so validating it against the contract schema preserves the source repo's
 * NATS-subscription guarantee without a subscribable broker. Every mutation is
 * exercised so all four event types stay conformant.
 */
import { Validator } from "@cfworker/json-schema";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface TodoEvent {
  type: string;
  source: string;
  data: {
    todo_id: string;
    user_id: string;
    title: string;
    completed: boolean;
    timestamp: string;
    channel: string;
    is_test: boolean;
  };
}

function eventSchema(): Record<string, unknown> {
  const asyncapi = parse(env.ASYNCAPI_YAML) as {
    components: { messages: Record<string, { payload: Record<string, unknown> }> };
  };
  return asyncapi.components.messages.TodoEvent.payload;
}

async function latestOutboxEvent(): Promise<TodoEvent> {
  const row = await env.OPERATIONAL_STORE
    // rowid = insertion order — created_at can tie within a millisecond.
    .prepare("SELECT payload FROM outbox ORDER BY rowid DESC LIMIT 1")
    .first<{ payload: string }>();
  expect(row).not.toBeNull();
  const event = JSON.parse(row!.payload) as TodoEvent;
  const result = new Validator(eventSchema() as never).validate(event);
  expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  return event;
}

async function create(title: string, headers: Record<string, string> = {}): Promise<{ id: string }> {
  const resp = await SELF.fetch("http://api/todos", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ title }),
  });
  expect(resp.status).toBe(201);
  return (await resp.json()) as { id: string };
}

async function patch(id: string, body: unknown): Promise<void> {
  const resp = await SELF.fetch(`http://api/todos/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(resp.status).toBe(200);
}

describe("event contract", () => {
  it("create emits a conformant todo.created for the dev user", async () => {
    const todo = await create("write the contract test");
    const event = await latestOutboxEvent();
    expect(event.type).toBe("todo.created");
    expect(event.source).toBe("urn:outcome-app-pattern:todo-service");
    expect(event.data.todo_id).toBe(todo.id);
    expect(event.data.user_id).toBe("dev");
    expect(event.data.completed).toBe(false);
    // No origin headers → a direct, real caller.
    expect(event.data.channel).toBe("api");
    expect(event.data.is_test).toBe(false);
  });

  it("records the declared channel and test flag on the event", async () => {
    await create("from the web, as a test", { "x-channel": "web", "x-test": "true" });
    const event = await latestOutboxEvent();
    expect(event.data.channel).toBe("web");
    expect(event.data.is_test).toBe(true);
  });

  it("records an unrecognised channel as api (never rejects)", async () => {
    await create("who are you", { "x-channel": "carrier-pigeon", "x-test": "banana" });
    const event = await latestOutboxEvent();
    expect(event.data.channel).toBe("api");
    expect(event.data.is_test).toBe(false);
  });

  it("completing emits a conformant todo.completed", async () => {
    const todo = await create("complete me");
    await patch(todo.id, { completed: true });
    const event = await latestOutboxEvent();
    expect(event.type).toBe("todo.completed");
    expect(event.data.completed).toBe(true);
  });

  it("renaming emits a conformant todo.updated", async () => {
    const todo = await create("rename me");
    await patch(todo.id, { title: "renamed" });
    const event = await latestOutboxEvent();
    expect(event.type).toBe("todo.updated");
    expect(event.data.title).toBe("renamed");
  });

  it("un-completing emits a conformant todo.updated", async () => {
    const todo = await create("uncomplete me");
    await patch(todo.id, { completed: true });
    await patch(todo.id, { completed: false });
    const event = await latestOutboxEvent();
    expect(event.type).toBe("todo.updated");
    expect(event.data.completed).toBe(false);
  });

  it("delete emits a conformant todo.deleted with the pre-delete snapshot", async () => {
    const todo = await create("delete me");
    const resp = await SELF.fetch(`http://api/todos/${todo.id}`, { method: "DELETE" });
    expect(resp.status).toBe(204);
    const event = await latestOutboxEvent();
    expect(event.type).toBe("todo.deleted");
    expect(event.data.todo_id).toBe(todo.id);
    expect(event.data.title).toBe("delete me");
  });
});
