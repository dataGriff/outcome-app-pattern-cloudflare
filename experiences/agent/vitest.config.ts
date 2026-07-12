import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// A stand-in todo API so the agent's tools can be exercised without the real
// domain worker. User-aware: it refuses calls without a forwarded Access JWT
// header (proving the agent forwards it) and keys an in-memory store by that
// token, mirroring the real per-user scoping. Module-scoped, mutated only by
// the one test.
interface Todo {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
}

const stores = new Map<string, Todo[]>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          async DOMAIN_API(request) {
            const token = request.headers.get("cf-access-jwt-assertion");
            if (!token) return json({ detail: "unauthorized" }, 401);
            let todos = stores.get(token);
            if (!todos) {
              todos = [];
              stores.set(token, todos);
            }
            const url = new URL(request.url);
            if (url.pathname === "/todos" && request.method === "POST") {
              const { title } = (await request.json()) as { title: string };
              const todo: Todo = {
                id: crypto.randomUUID(),
                title,
                completed: false,
                created_at: "2026-07-08T10:00:00.000Z",
                completed_at: null,
              };
              todos.unshift(todo);
              return json(todo, 201);
            }
            if (url.pathname === "/todos" && request.method === "GET") {
              const completed = url.searchParams.get("completed");
              const limit = Number(url.searchParams.get("limit") ?? "100");
              const filtered =
                completed === null ? todos : todos.filter((t) => t.completed === (completed === "true"));
              return json(filtered.slice(0, limit));
            }
            const match = url.pathname.match(/^\/todos\/([^/]+)$/);
            if (match) {
              const todo = todos.find((t) => t.id === match[1]);
              if (!todo) return json({ detail: "not found" }, 404);
              if (request.method === "PATCH") {
                const patch = (await request.json()) as { title?: string; completed?: boolean };
                if (patch.title !== undefined) todo.title = patch.title;
                if (patch.completed !== undefined) {
                  todo.completed = patch.completed;
                  todo.completed_at = patch.completed ? "2026-07-08T11:00:00.000Z" : null;
                }
                return json(todo);
              }
              if (request.method === "DELETE") {
                todos.splice(todos.indexOf(todo), 1);
                return new Response(null, { status: 204 });
              }
            }
            return new Response("not found", { status: 404 });
          },
        },
      },
    }),
  ],
});
