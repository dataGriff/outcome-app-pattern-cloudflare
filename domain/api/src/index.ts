import type { Env } from "./env";
import { app } from "./routes";

export { OutboxRelayDO } from "./relay";
export { StreamDO } from "./stream";

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
