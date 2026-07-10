# Deployment

Deploy is a single `task deploy` (remote D1 migrations, then domain → platform → web → agent, so
the experiences' service bindings resolve against an already-live domain), run automatically by
CI on push to `main`.

## One-time cloud setup

1. **Enable R2** once in the Cloudflare dashboard (the free tier still requires the initial
   opt-in), then `task bootstrap:cloud` to create the D1 database, the queue, and the
   `colour-data` bucket.
2. **GitHub secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and a read-only R2 S3 key
   pair (`R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY`) for the post-deploy `datacontract test`.
3. **GitHub variable:** `WORKERS_SUBDOMAIN` (your `*.workers.dev` subdomain) so the verify job can
   reach the deployed channels.

## CI flow

On push to `main`: `test` (the hermetic `task ci`) → `deploy` (`task deploy`) → `verify`. The
**verify** job smoke-tests the deployed stack end to end — generate, latest, the SSE feed,
cross-process queue delivery to the operational product, the Parquet summariser — and runs the
real `datacontract test` against both products over R2's S3 API. See [testing](../testing/index.md).

## Live channels

Once deployed (subdomain = `WORKERS_SUBDOMAIN`):

- `https://colour-behaviour-service.<subdomain>.workers.dev` — the domain API
- `https://colour-data-products.<subdomain>.workers.dev` — products + visualisation
- `https://colour-web.<subdomain>.workers.dev` — the web channel
- `https://colour-agent.<subdomain>.workers.dev/mcp` — the MCP agent (see
  [experiences](../experiences/index.md#interacting-with-the-deployed-agent))

## Abuse protection (rate limiting)

The API is open (no auth, CORS `*`), so the one **write** endpoint — `POST /colours` — is guarded
against abuse that would drive R2 writes and storage cost. Two native [Workers rate
limiters](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (free,
in-memory per-colo) sit in front of it, in `domain/api`:

- **`RL_PER_IP`** — 10 requests/min keyed by `cf-connecting-ip`, so a single flooder is capped.
  This targets the **directly-reachable public endpoint**, where Cloudflare sets an unspoofable
  `cf-connecting-ip`.
- **`RL_GLOBAL`** — 60 requests/min account-wide: the **wallet ceiling** against distributed abuse
  (per-IP limits don't stop many IPs). When either trips, the endpoint returns a
  contract-documented **429** with `Retry-After`.

The web and agent channels reach the API over a **service binding** (no client IP), so they're
bounded by the global cap only — the per-IP bucket is skipped for them, so their users aren't
throttled collectively. An attacker can't take that path: service bindings aren't publicly
invocable, and a direct caller can't suppress `cf-connecting-ip`.

Reads (`GET /colours`, `/colours/latest`, `/events/stream`) are unlimited — they don't write.
Enforcement is gated by the `RATE_LIMIT` var: `"on"` in `wrangler.jsonc` (deployed), overridden to
`"off"` for local `wrangler dev` (the Schemathesis run passes `--var RATE_LIMIT:off`) and in vitest,
so the hermetic gates aren't throttled. The limits live in `domain/api/wrangler.jsonc`
(`unsafe.bindings`); tune them there. WAF/dashboard rate-limiting rules don't apply to
`*.workers.dev`, so this is enforced in-Worker.

For a stricter, globally-consistent limit you'd move to a Durable Object token bucket, and for the
UI channels a [Turnstile](https://developers.cloudflare.com/turnstile/) challenge on the generate
button stops bots — both are deliberate next steps, not needed for the demo.
