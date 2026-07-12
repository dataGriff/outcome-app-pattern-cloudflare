import { readFileSync } from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      const asyncapiYaml = readFileSync(
        path.join(import.meta.dirname, "../contracts/api/todo-service.asyncapi.yaml"),
        "utf8",
      );
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Override RATE_LIMIT off so the SELF-based hermetic tests (which POST
          // many times) aren't throttled; the 429 path is covered in isolation
          // by tests/unit/ratelimit.test.ts.
          bindings: { TEST_MIGRATIONS: migrations, ASYNCAPI_YAML: asyncapiYaml, RATE_LIMIT: "off" },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
