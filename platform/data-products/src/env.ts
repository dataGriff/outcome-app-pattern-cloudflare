export interface Env {
  OBJECT_STORAGE: R2Bucket;
  /** Days kept "open" (recomputed each run) before a day is sealed; default 2. */
  SUMMARISER_OPEN_DAYS?: string;
  /** Cloudflare Access identity for the read surface. Set both (with the hostname
   * behind an Access app) to gate /products/* and /run/summarise. Unset = open. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/** The CloudEvent shape published by the domain's outbox relay. `data.title`
 * is transport-only user content — the consumer strips it (and never lands
 * emails) before the long-retention analytical layer. */
export interface TodoEvent {
  id: string;
  source: string;
  specversion: "1.0";
  type: string;
  time: string;
  data: {
    todo_id: string;
    user_id: string;
    title: string;
    completed: boolean;
    timestamp: string;
    channel: string;
    is_test: boolean;
  };
}
