export const SOURCE = "urn:outcome-app-pattern:todo-service";

export type TodoEventType = "todo.created" | "todo.updated" | "todo.completed" | "todo.deleted";

/** The experiences a mutation can originate from. Callers self-declare via the
 * X-Channel header; anything else records as "api" (direct callers). */
export const CHANNELS = ["web", "mobile", "agent", "api"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Where a mutation came from and whether it was declared test traffic —
 * analytics dimensions, resolved per request at the route layer. */
export interface Origin {
  channel: Channel;
  is_test: boolean;
}

/** Snapshot of the todo at mutation time. `title` rides the transport for live
 * UI delivery; the data-product consumer strips it before the analytical layer.
 * `channel`/`is_test` record where the mutation happened and whether it was
 * test traffic — the analytical dimensions both data products keep. */
export interface TodoSnapshot {
  todo_id: string;
  user_id: string;
  title: string;
  completed: boolean;
  timestamp: string;
  channel: Channel;
  is_test: boolean;
}

export interface TodoEvent {
  id: string;
  source: typeof SOURCE;
  specversion: "1.0";
  type: TodoEventType;
  time: string;
  data: TodoSnapshot;
}

/** Structured CloudEvent for the outbox / events queue. Kept as a plain object
 * so we depend on nothing fragile to serialise it. */
export function buildTodoEvent(type: TodoEventType, snapshot: TodoSnapshot): TodoEvent {
  return {
    id: crypto.randomUUID(),
    source: SOURCE,
    specversion: "1.0",
    type,
    time: snapshot.timestamp,
    data: snapshot,
  };
}
