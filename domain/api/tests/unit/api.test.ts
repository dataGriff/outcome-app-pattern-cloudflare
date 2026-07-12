/** CRUD behaviour of the todo API against a hermetic local D1. Access is
 * unprovisioned here, so every request acts as the fixed dev identity —
 * exercising the same per-user code paths production takes. */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
}

async function create(title: string): Promise<Todo> {
  const resp = await SELF.fetch("http://api/todos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  expect(resp.status).toBe(201);
  return (await resp.json()) as Todo;
}

async function patch(id: string, body: unknown): Promise<Response> {
  return SELF.fetch(`http://api/todos/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /todos", () => {
  it("creates a todo with the full contract shape", async () => {
    const todo = await create("walk the dog");
    expect(todo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(todo.title).toBe("walk the dog");
    expect(todo.completed).toBe(false);
    expect(todo.created_at).toBeTruthy();
    expect(todo.completed_at).toBeNull();
  });

  it("422s an empty title", async () => {
    const resp = await SELF.fetch("http://api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(resp.status).toBe(422);
  });

  it("422s a missing title and an overlong title", async () => {
    for (const body of [{}, { title: "x".repeat(257) }]) {
      const resp = await SELF.fetch("http://api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(resp.status).toBe(422);
    }
  });

  it("422s a malformed JSON body", async () => {
    const resp = await SELF.fetch("http://api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(resp.status).toBe(422);
  });
});

describe("GET /todos", () => {
  it("lists most recent first and honours limit", async () => {
    await create("first");
    await create("second");
    await create("third");
    const resp = await SELF.fetch("http://api/todos?limit=2");
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Todo[];
    expect(body.map((t) => t.title)).toEqual(["third", "second"]);
  });

  it("filters by completed state", async () => {
    const a = await create("done one");
    await create("open one");
    await patch(a.id, { completed: true });

    const done = (await (await SELF.fetch("http://api/todos?completed=true")).json()) as Todo[];
    expect(done.map((t) => t.title)).toEqual(["done one"]);
    const open = (await (await SELF.fetch("http://api/todos?completed=false")).json()) as Todo[];
    expect(open.map((t) => t.title)).toEqual(["open one"]);
  });

  it("422s invalid query params", async () => {
    expect((await SELF.fetch("http://api/todos?limit=0")).status).toBe(422);
    expect((await SELF.fetch("http://api/todos?limit=nonsense")).status).toBe(422);
    expect((await SELF.fetch("http://api/todos?completed=maybe")).status).toBe(422);
  });
});

describe("GET /todos/{id}", () => {
  it("returns the todo", async () => {
    const created = await create("find me");
    const resp = await SELF.fetch(`http://api/todos/${created.id}`);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(created);
  });

  it("404s a missing id", async () => {
    const resp = await SELF.fetch(`http://api/todos/${crypto.randomUUID()}`);
    expect(resp.status).toBe(404);
  });
});

describe("PATCH /todos/{id}", () => {
  it("renames", async () => {
    const created = await create("old title");
    const resp = await patch(created.id, { title: "new title" });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Todo;
    expect(body.title).toBe("new title");
    expect(body.completed).toBe(false);
  });

  it("completes (sets completed_at) and un-completes (clears it)", async () => {
    const created = await create("toggle me");
    const done = (await (await patch(created.id, { completed: true })).json()) as Todo;
    expect(done.completed).toBe(true);
    expect(done.completed_at).toBeTruthy();

    const undone = (await (await patch(created.id, { completed: false })).json()) as Todo;
    expect(undone.completed).toBe(false);
    expect(undone.completed_at).toBeNull();
  });

  it("422s an empty patch", async () => {
    const created = await create("no-op");
    expect((await patch(created.id, {})).status).toBe(422);
  });

  it("404s a missing id", async () => {
    expect((await patch(crypto.randomUUID(), { completed: true })).status).toBe(404);
  });
});

describe("DELETE /todos/{id}", () => {
  it("204s and removes the todo", async () => {
    const created = await create("delete me");
    const resp = await SELF.fetch(`http://api/todos/${created.id}`, { method: "DELETE" });
    expect(resp.status).toBe(204);
    expect((await SELF.fetch(`http://api/todos/${created.id}`)).status).toBe(404);
  });

  it("404s a missing id", async () => {
    const resp = await SELF.fetch(`http://api/todos/${crypto.randomUUID()}`, { method: "DELETE" });
    expect(resp.status).toBe(404);
  });
});
