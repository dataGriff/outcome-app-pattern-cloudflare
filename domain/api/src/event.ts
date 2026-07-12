export const SOURCE = "urn:outcome-app-pattern:todo-service";

export type TodoEventType = "todo.created" | "todo.updated" | "todo.completed" | "todo.deleted";

/** Snapshot of the todo at mutation time. `title` rides the transport for live
 * UI delivery; the data-product consumer strips it before the analytical layer. */
export interface TodoSnapshot {
  todo_id: string;
  user_id: string;
  title: string;
  completed: boolean;
  timestamp: string;
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
