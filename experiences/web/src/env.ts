export interface Env {
  // The behaviour API, reached over a service binding — same-origin from the
  // browser's perspective, no CORS on writes or the live feed.
  DOMAIN_API: Fetcher;
  // Cloudflare Turnstile secret. Set it (`wrangler secret put TURNSTILE_SECRET`)
  // to require a human challenge before this channel forwards a generation.
  // Unset = inert (the demo runs without it). See docs/deployment.
  TURNSTILE_SECRET?: string;
  // Cloudflare Access identity. When this channel's hostname is behind Access,
  // the edge injects the JWT; set both to validate it here (defence in depth)
  // and gate /api/*. Unset = inert. See docs/security.
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
