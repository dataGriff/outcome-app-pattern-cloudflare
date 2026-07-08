import { readFileSync } from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      const asyncapiYaml = readFileSync(
        path.join(import.meta.dirname, "../contracts/api/behaviour-service.asyncapi.yaml"),
        "utf8",
      );
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ASYNCAPI_YAML: asyncapiYaml },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
