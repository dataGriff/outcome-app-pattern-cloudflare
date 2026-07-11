export interface Env {
  OBJECT_STORAGE: R2Bucket;
  /** Days kept "open" (recomputed each run) before a day is sealed; default 2. */
  SUMMARISER_OPEN_DAYS?: string;
  /** Cloudflare Access identity for the read surface. Set both (with the hostname
   * behind an Access app) to gate /products/* and /run/summarise. Unset = open. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/** The CloudEvent shape published by the domain's outbox relay. */
export interface ColourGeneratedEvent {
  id: string;
  source: string;
  specversion: "1.0";
  type: string;
  time: string;
  data: { colour: string; timestamp: string };
}
