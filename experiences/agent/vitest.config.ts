import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// A stand-in behaviour API so the agent's tools can be exercised without the
// real domain worker. Stateful: latest 404s until the first generate, so the
// 404 → detail mapping is covered. Module-scoped, mutated only by the one test.
const history: { colour: string; timestamp: string }[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          DOMAIN_API(request) {
            const url = new URL(request.url);
            if (url.pathname === "/colours" && request.method === "POST") {
              const ev = { colour: "green", timestamp: "2026-07-08T10:00:00.000Z" };
              history.unshift(ev);
              return json(ev);
            }
            if (url.pathname === "/colours/latest") {
              return history.length ? json(history[0]) : json({ detail: "not found" }, 404);
            }
            if (url.pathname === "/colours") {
              const limit = Number(url.searchParams.get("limit") ?? "10");
              return json(history.slice(0, limit));
            }
            return new Response("not found", { status: 404 });
          },
        },
      },
    }),
  ],
});
