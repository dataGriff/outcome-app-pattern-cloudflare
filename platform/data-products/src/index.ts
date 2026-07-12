import { consume } from "./consumer";
import type { Env, TodoEvent } from "./env";
import { app } from "./products";
import { summariseOnce } from "./summariser";

export default {
  fetch: app.fetch,
  queue: consume,
  scheduled: async (_controller, env) => {
    await summariseOnce(env);
  },
} satisfies ExportedHandler<Env, TodoEvent>;
