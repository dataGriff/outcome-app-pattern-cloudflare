/** Operational store (D1) for the todo domain.
 *
 * The API's durable state and its transactional outbox live here. Writing the
 * todo mutation and the outbox row in one atomic batch is what lets the relay
 * ship events without a dual-write to the queue inside the request.
 *
 * Every function takes the owning user (the Access `sub` claim) and scopes its
 * SQL WHERE user_id = ? — this module is the one seam where identity becomes
 * row ownership, which is what the user-isolation test locks down.
 */
import type { components } from "../types/api";
import type { Env } from "./env";
import { buildTodoEvent, type TodoEventType } from "./event";

export type Todo = components["schemas"]["Todo"];

interface TodoRow {
  id: string;
  user_id: string;
  title: string;
  completed: number;
  created_at: string;
  completed_at: string | null;
}

function toTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function outboxInsert(env: Env, type: TodoEventType, row: TodoRow, ts: string): D1PreparedStatement {
  const event = buildTodoEvent(type, {
    todo_id: row.id,
    user_id: row.user_id,
    title: row.title,
    completed: row.completed === 1,
    timestamp: ts,
  });
  return env.OPERATIONAL_STORE
    .prepare("INSERT INTO outbox (id, subject, payload, created_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), event.type, JSON.stringify(event), ts);
}

/** Insert the todo and its todo.created outbox event in one atomic D1 batch.
 *
 * D1 batch statements cannot read each other's results, so the app clock
 * supplies the single timestamp that the operational row, the outbox row and
 * the event all share. */
export async function createTodo(env: Env, userId: string, title: string): Promise<Todo> {
  const ts = new Date().toISOString();
  const row: TodoRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    title,
    completed: 0,
    created_at: ts,
    completed_at: null,
  };
  await env.OPERATIONAL_STORE.batch([
    env.OPERATIONAL_STORE
      .prepare("INSERT INTO todos (id, user_id, title, completed, created_at) VALUES (?, ?, ?, 0, ?)")
      .bind(row.id, userId, title, ts),
    outboxInsert(env, "todo.created", row, ts),
  ]);
  return toTodo(row);
}

export async function listTodos(
  env: Env,
  userId: string,
  opts: { completed?: boolean; limit: number },
): Promise<Todo[]> {
  const filter = opts.completed === undefined ? "" : " AND completed = ?";
  const binds: (string | number)[] = [userId];
  if (opts.completed !== undefined) binds.push(opts.completed ? 1 : 0);
  binds.push(opts.limit);
  const { results } = await env.OPERATIONAL_STORE
    .prepare(
      // rowid tie-breaks same-millisecond inserts into stable insertion order.
      `SELECT id, user_id, title, completed, created_at, completed_at FROM todos WHERE user_id = ?${filter} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .bind(...binds)
    .all<TodoRow>();
  return results.map(toTodo);
}

export async function getTodo(env: Env, userId: string, id: string): Promise<Todo | null> {
  const row = await env.OPERATIONAL_STORE
    .prepare(
      "SELECT id, user_id, title, completed, created_at, completed_at FROM todos WHERE user_id = ? AND id = ?",
    )
    .bind(userId, id)
    .first<TodoRow>();
  return row ? toTodo(row) : null;
}

/** Apply a partial update and enqueue the matching event: transitioning to
 * completed emits todo.completed; anything else (rename, un-complete) emits
 * todo.updated. Returns null when the todo doesn't exist for this user. */
export async function updateTodo(
  env: Env,
  userId: string,
  id: string,
  patch: { title?: string; completed?: boolean },
): Promise<Todo | null> {
  const existing = await env.OPERATIONAL_STORE
    .prepare(
      "SELECT id, user_id, title, completed, created_at, completed_at FROM todos WHERE user_id = ? AND id = ?",
    )
    .bind(userId, id)
    .first<TodoRow>();
  if (!existing) return null;

  const ts = new Date().toISOString();
  const wasCompleted = existing.completed === 1;
  const nowCompleted = patch.completed ?? wasCompleted;
  const row: TodoRow = {
    ...existing,
    title: patch.title ?? existing.title,
    completed: nowCompleted ? 1 : 0,
    completed_at: nowCompleted ? (wasCompleted ? existing.completed_at : ts) : null,
  };
  const type: TodoEventType = !wasCompleted && nowCompleted ? "todo.completed" : "todo.updated";
  await env.OPERATIONAL_STORE.batch([
    env.OPERATIONAL_STORE
      .prepare("UPDATE todos SET title = ?, completed = ?, completed_at = ? WHERE user_id = ? AND id = ?")
      .bind(row.title, row.completed, row.completed_at, userId, id),
    outboxInsert(env, type, row, ts),
  ]);
  return toTodo(row);
}

/** Delete and enqueue todo.deleted (snapshot of the pre-delete state).
 * Returns false when the todo doesn't exist for this user. */
export async function deleteTodo(env: Env, userId: string, id: string): Promise<boolean> {
  const existing = await env.OPERATIONAL_STORE
    .prepare(
      "SELECT id, user_id, title, completed, created_at, completed_at FROM todos WHERE user_id = ? AND id = ?",
    )
    .bind(userId, id)
    .first<TodoRow>();
  if (!existing) return false;

  const ts = new Date().toISOString();
  await env.OPERATIONAL_STORE.batch([
    env.OPERATIONAL_STORE
      .prepare("DELETE FROM todos WHERE user_id = ? AND id = ?")
      .bind(userId, id),
    outboxInsert(env, "todo.deleted", existing, ts),
  ]);
  return true;
}
