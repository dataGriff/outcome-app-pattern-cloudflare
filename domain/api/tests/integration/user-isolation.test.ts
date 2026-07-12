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

describe("user isolation", () => {
  it("list never crosses users", async () => {
    await createTodo(env, "alice", "alice one");
    await createTodo(env, "alice", "alice two");
    await createTodo(env, "bob", "bob one");

    const alice = await listTodos(env, "alice", { limit: 100 });
    expect(alice.map((t) => t.title).sort()).toEqual(["alice one", "alice two"]);
    const bob = await listTodos(env, "bob", { limit: 100 });
    expect(bob.map((t) => t.title)).toEqual(["bob one"]);
  });

  it("get returns null for another user's todo — same as a missing one", async () => {
    const bobs = await createTodo(env, "bob", "bob's secret");
    expect(await getTodo(env, "alice", bobs.id)).toBeNull();
    expect(await getTodo(env, "bob", bobs.id)).not.toBeNull();
  });

  it("update cannot touch another user's todo", async () => {
    const bobs = await createTodo(env, "bob", "bob's task");
    expect(await updateTodo(env, "alice", bobs.id, { completed: true })).toBeNull();

    const unchanged = await getTodo(env, "bob", bobs.id);
    expect(unchanged?.completed).toBe(false);
    expect(unchanged?.title).toBe("bob's task");
  });

  it("delete cannot remove another user's todo", async () => {
    const bobs = await createTodo(env, "bob", "bob's keeper");
    expect(await deleteTodo(env, "alice", bobs.id)).toBe(false);
    expect(await getTodo(env, "bob", bobs.id)).not.toBeNull();
  });
});
