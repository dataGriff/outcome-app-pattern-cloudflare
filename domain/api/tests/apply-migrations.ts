import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

await applyD1Migrations(env.OPERATIONAL_STORE, env.TEST_MIGRATIONS);

// This pool version has no per-test isolated storage — start each test from
// an empty operational store instead.
beforeEach(async () => {
  await env.OPERATIONAL_STORE.batch([
    env.OPERATIONAL_STORE.prepare("DELETE FROM outbox"),
    env.OPERATIONAL_STORE.prepare("DELETE FROM colours"),
  ]);
});
