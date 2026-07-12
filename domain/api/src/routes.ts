import type { AccessIdentity } from "@todo/access-jwt";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { parse } from "yaml";
import specText from "../../contracts/api/todo-service.openapi.yaml";
import type { components } from "../types/api";
import { requireAuth } from "./auth";
import { createTodo, deleteTodo, getTodo, listTodos, updateTodo } from "./db";
import type { Env } from "./env";
import { CHANNELS, type Channel, type Origin } from "./event";
import { rateLimit } from "./ratelimit";

type NewTodo = components["schemas"]["NewTodo"];
type TodoPatch = components["schemas"]["TodoPatch"];

/** The committed OpenAPI contract, served verbatim at /openapi.json. */
export const openapiDoc = parse(specText) as {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
};

const DOCS_HTML = `<!doctype html>
<html>
  <head><title>Todo Service — API docs</title><meta charset="utf-8"></head>
  <body>
    <div id="swagger-ui"></div>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });</script>
  </body>
</html>`;

type Ctx = { Bindings: Env; Variables: { identity: AccessIdentity } };

export const app = new Hono<Ctx>();

// Experiences (mobile web export, agents) call the API cross-origin. Expose
// Retry-After so a cross-origin caller can read how long to back off on a 429.
app.use("*", cors({ exposeHeaders: ["Retry-After"] }));

const TITLE_MAX = 256;

/** Validate a request body against the contract's NewTodo/TodoPatch rules.
 * Returns the invalid-field detail, or null when valid. Mirrors the spec
 * (required title on create, ≥1 known field on patch, no unknown fields,
 * title 1..256) — the Schemathesis run fuzzes exactly these bounds. */
function invalidTodoBody(body: unknown, requireTitle: boolean): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "body must be a JSON object";
  }
  const rec = body as Record<string, unknown>;
  const unknown = Object.keys(rec).filter((k) => k !== "title" && k !== "completed");
  if (unknown.length > 0) return `unknown field: ${unknown[0]}`;
  if (requireTitle && rec.title === undefined) return "title is required";
  if (!requireTitle && rec.title === undefined && rec.completed === undefined) {
    return "at least one of title / completed is required";
  }
  if (rec.title !== undefined) {
    if (typeof rec.title !== "string" || rec.title.length < 1 || rec.title.length > TITLE_MAX) {
      return `title must be a string of 1..${TITLE_MAX} characters`;
    }
  }
  if (rec.completed !== undefined && typeof rec.completed !== "boolean") {
    return "completed must be a boolean";
  }
  return null;
}

async function parseBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown | undefined> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** Analytics dimensions for the mutation's event: which experience performed
 * it (X-Channel, self-declared by the first-party channels; anything else is
 * "api") and whether the caller flagged it as test traffic (X-Test). Recorded,
 * never rejected — hygiene for the data products, not a security boundary. */
function originOf(request: Request): Origin {
  const declared = request.headers.get("x-channel");
  const channel: Channel = (CHANNELS as readonly string[]).includes(declared ?? "")
    ? (declared as Channel)
    : "api";
  return { channel, is_test: request.headers.get("x-test") === "true" };
}

// Auth on every route: per-user data means nothing is answerable without an
// identity (the dev fallback supplies one while Access is unprovisioned).
// Rate limiting guards the mutations — each drives an outbox row and,
// downstream, an R2 write. See src/auth.ts and src/ratelimit.ts.
app.post("/todos", requireAuth, rateLimit, async (c) => {
  const body = await parseBody(c);
  const invalid = body === undefined ? "body must be valid JSON" : invalidTodoBody(body, true);
  if (invalid !== null) return c.json({ detail: invalid }, 422);
  const todo = await createTodo(c.env, c.get("identity").sub, (body as NewTodo).title, originOf(c.req.raw));
  // Poke the relay for immediate drain; its alarm is the at-least-once backstop.
  c.executionCtx.waitUntil(
    c.env.OUTBOX_RELAY.get(c.env.OUTBOX_RELAY.idFromName("relay")).poke(),
  );
  return c.json(todo, 201);
});

app.get("/todos", requireAuth, async (c) => {
  // The contract defines exactly two query params — an unknown one is a
  // caller error, not something to silently ignore (Schemathesis probes this).
  // Raw searchParams, not c.req.query(): Hono drops empty-named params.
  const unknownParam = [...new URL(c.req.url).searchParams.keys()].find(
    (k) => k !== "limit" && k !== "completed",
  );
  if (unknownParam !== undefined) {
    return c.json({ detail: `unknown query parameter: ${JSON.stringify(unknownParam)}` }, 422);
  }
  const rawLimit = c.req.query("limit");
  let limit = 100;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      // 422 to match the contract, not a generic 400.
      return c.json({ detail: "limit must be an integer between 1 and 100" }, 422);
    }
  }
  const rawCompleted = c.req.query("completed");
  let completed: boolean | undefined;
  if (rawCompleted !== undefined) {
    if (rawCompleted !== "true" && rawCompleted !== "false") {
      return c.json({ detail: "completed must be true or false" }, 422);
    }
    completed = rawCompleted === "true";
  }
  const todos = await listTodos(c.env, c.get("identity").sub, { completed, limit });
  return c.json(todos);
});

app.get("/todos/:id", requireAuth, async (c) => {
  const todo = await getTodo(c.env, c.get("identity").sub, c.req.param("id")!);
  // Another user's todo and a missing one are the same 404 — ids never leak.
  if (todo === null) return c.json({ detail: "not found" }, 404);
  return c.json(todo);
});

app.patch("/todos/:id", requireAuth, rateLimit, async (c) => {
  const body = await parseBody(c);
  const invalid = body === undefined ? "body must be valid JSON" : invalidTodoBody(body, false);
  if (invalid !== null) return c.json({ detail: invalid }, 422);
  const todo = await updateTodo(c.env, c.get("identity").sub, c.req.param("id")!, body as TodoPatch, originOf(c.req.raw));
  if (todo === null) return c.json({ detail: "not found" }, 404);
  c.executionCtx.waitUntil(
    c.env.OUTBOX_RELAY.get(c.env.OUTBOX_RELAY.idFromName("relay")).poke(),
  );
  return c.json(todo);
});

app.delete("/todos/:id", requireAuth, rateLimit, async (c) => {
  const deleted = await deleteTodo(c.env, c.get("identity").sub, c.req.param("id")!, originOf(c.req.raw));
  if (!deleted) return c.json({ detail: "not found" }, 404);
  c.executionCtx.waitUntil(
    c.env.OUTBOX_RELAY.get(c.env.OUTBOX_RELAY.idFromName("relay")).poke(),
  );
  return c.body(null, 204);
});

app.get("/events/stream", requireAuth, (c) => {
  // One StreamDO per user: isolation by construction — the relay routes each
  // event to its owner's object, so there is no cross-user filter to get wrong.
  const stub = c.env.STREAM.get(c.env.STREAM.idFromName(c.get("identity").sub));
  return stub.fetch(c.req.raw);
});

app.get("/openapi.json", (c) => c.json(openapiDoc));
app.get("/docs", (c) => c.html(DOCS_HTML));

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/** Match a concrete request path against a spec path, treating {param}
 * segments as single-segment wildcards — an unspec'd method on /todos/abc
 * must find /todos/{id}, which a literal lookup can't. */
function specPathFor(path: string): Record<string, unknown> | undefined {
  if (openapiDoc.paths[path] !== undefined) return openapiDoc.paths[path];
  for (const [specPath, item] of Object.entries(openapiDoc.paths)) {
    if (!specPath.includes("{")) continue;
    const pattern = new RegExp(
      `^${specPath.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`,
    );
    if (pattern.test(path)) return item;
  }
  return undefined;
}

// Contract-driven 405: a request to a path the spec knows, with a method it
// doesn't, is method-not-allowed rather than not-found.
app.notFound((c) => {
  const item = specPathFor(new URL(c.req.url).pathname);
  if (item !== undefined) {
    const allowed = Object.keys(item)
      .filter((m) => HTTP_METHODS.includes(m))
      .map((m) => m.toUpperCase());
    if (!allowed.includes(c.req.method)) {
      return c.json({ detail: "method not allowed" }, 405, { Allow: allowed.join(", ") });
    }
  }
  return c.json({ detail: "not found" }, 404);
});
