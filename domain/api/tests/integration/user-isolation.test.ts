/** User isolation at the db seam.
 *
 * HTTP-level cross-user tests aren't possible hermetically (a second identity
 * needs a real Access JWT and remote JWKS), but every handler maps identity to
 * data through exactly one seam — identity.sub → user_id in src/db.ts — so
 * locking that seam down for two users covers the property. See docs/testing.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createTodo, deleteTodo, getTodo, listTodos, updateTodo } from "../../src/db";
import type { Origin } from "../../src/event";

const ORIGIN: Origin = { channel: "api", is_test: false };

describe("user isolation", () => {
  it("list never crosses users", async () => {
    await createTodo(env, "alice", "alice one", ORIGIN);
    await createTodo(env, "alice", "alice two", ORIGIN);
    await createTodo(env, "bob", "bob one", ORIGIN);

    const alice = await listTodos(env, "alice", { limit: 100 });
    expect(alice.map((t) => t.title).sort()).toEqual(["alice one", "alice two"]);
    const bob = await listTodos(env, "bob", { limit: 100 });
    expect(bob.map((t) => t.title)).toEqual(["bob one"]);
  });

  it("get returns null for another user's todo — same as a missing one", async () => {
    const bobs = await createTodo(env, "bob", "bob's secret", ORIGIN);
    expect(await getTodo(env, "alice", bobs.id)).toBeNull();
    expect(await getTodo(env, "bob", bobs.id)).not.toBeNull();
  });

  it("update cannot touch another user's todo", async () => {
    const bobs = await createTodo(env, "bob", "bob's task", ORIGIN);
    expect(await updateTodo(env, "alice", bobs.id, { completed: true }, ORIGIN)).toBeNull();

    const unchanged = await getTodo(env, "bob", bobs.id);
    expect(unchanged?.completed).toBe(false);
    expect(unchanged?.title).toBe("bob's task");
  });

  it("delete cannot remove another user's todo", async () => {
    const bobs = await createTodo(env, "bob", "bob's keeper", ORIGIN);
    expect(await deleteTodo(env, "alice", bobs.id, ORIGIN)).toBe(false);
    expect(await getTodo(env, "bob", bobs.id)).not.toBeNull();
  });
});
