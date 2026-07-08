import type { Env as WorkerEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      OPERATIONAL_CONTRACT_YAML: string;
      PERFORMANCE_CONTRACT_YAML: string;
    }
  }
}

export {};
