export interface Env {
  // The behaviour API, reached over a service binding — same-origin from the
  // browser's perspective, no CORS on writes or the live feed.
  DOMAIN_API: Fetcher;
}
