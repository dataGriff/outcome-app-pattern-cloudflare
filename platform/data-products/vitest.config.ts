import { readFileSync } from "node:fs";
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const contract = (name: string) =>
  readFileSync(
    path.join(import.meta.dirname, `../../domain/contracts/data/${name}.contract.yaml`),
    "utf8",
  );

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          OPERATIONAL_CONTRACT_YAML: contract("colour-operational"),
          PERFORMANCE_CONTRACT_YAML: contract("colour-performance"),
        },
      },
    }),
  ],
});
