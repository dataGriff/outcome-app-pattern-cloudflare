# outcome-app-pattern-cloudflare

The [outcome-app-pattern](https://github.com/dataGriff/outcome-app-pattern) reference —
a **source-aligned, API-first, multichannel domain** — ported to run entirely on
**Cloudflare's free plan**, in TypeScript.

Same pattern, same colour domain, same contracts; only the platform changes. This repo
is also the first dry run of the source repo's
[replication guide](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/replication.md):
the three zones, the naming rules, and the contract-first order of work all carry over.

## Role mapping

Every role from the pattern keeps its name; only the implementation underneath is swapped
(role-named bindings, honest implementation names in `wrangler.jsonc`):

| Pattern role | Source implementation | Cloudflare implementation |
| --- | --- | --- |
| behaviour API | FastAPI | `colour-behaviour-service` Worker (Hono) |
| operational-store | Postgres | D1 — one atomic `batch()` is the outbox transaction |
| relay | asyncpg loop | `OutboxRelayDO` Durable Object (poke on write + alarm backstop + prune) |
| events | NATS | Queue `colour-events` |
| SSE bridge | in-API NATS subscriber | `StreamDO` Durable Object (SSE fan-out) |
| streaming | bento | queue consumer → JSONL to R2 |
| object-storage | SeaweedFS (S3) | R2 bucket `colour-data` |
| summariser | pandas loop | cron `scheduled()` → Parquet |
| visualisation | Streamlit | static page + `/products/*` read endpoints |
| web experience | Flask | `colour-web` Worker (static assets + same-origin proxy) |
| mobile experience | Expo/React Native | unchanged (points at the deployed API) |
| agent experience | MCP server (stdio) | `colour-agent` Worker (MCP over streamable-http) |

## Run it locally

One command brings up all four workers, each on its own port, wired by Wrangler's
local dev registry (service bindings **and** cross-process queue delivery):

```bash
npm ci
task up      # domain :8787  data-products :8788  web :8789  agent :8790
```

Then open the web channel at http://localhost:8789, run the mobile app with
`task run:mobile`, or point an MCP client at http://localhost:8790/mcp. `task ci`
runs the whole hermetic suite (contract lints, generated-types staleness,
typecheck, unit/integration/data-product/agent tests, and Schemathesis).

## Deploying

Deploy is a single `task deploy` (remote D1 migrations, then domain → platform →
web → agent), run automatically by CI on push to `main`. It needs some one-time
setup on the Cloudflare account:

1. **Enable R2** once in the Cloudflare dashboard (the free tier still requires
   the initial opt-in), then `task bootstrap:cloud` to create the D1 database,
   the queue and the `colour-data` bucket.
2. **GitHub secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and a
   read-only R2 S3 key pair (`R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY`)
   for the post-deploy `datacontract test`.
3. **GitHub variable:** `WORKERS_SUBDOMAIN` (your `*.workers.dev` subdomain) so
   the verify job can reach the deployed channels.

The CI `verify` job then smoke-tests the deployed stack end to end — generate,
latest, the SSE feed, cross-process queue delivery to the operational product,
the Parquet summariser — and runs the real `datacontract test` against both
products over R2's S3 API.

## Contracts

Copied from the source repo with **only infrastructure edits** (server URLs, storage
locations) — the models, channels, and purposes are identical:

- `domain/contracts/api/behaviour-service.openapi.yaml` — the HTTP surface (source of truth)
- `domain/contracts/api/behaviour-service.asyncapi.yaml` — the event channel
- `domain/contracts/data/colour-operational.contract.yaml` — raw JSONL product (operational awareness)
- `domain/contracts/data/colour-performance.contract.yaml` — curated Parquet product (performance)
- `domain/events/colour.generated.schema.json` — CloudEvent payload schema
