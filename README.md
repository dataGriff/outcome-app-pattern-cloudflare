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

## Status

Being built contract-first, phase by phase (contracts → infrastructure → behaviour →
data products → experiences → CI). Quickstart and deployed URLs land with the final phase.

## Contracts

Copied from the source repo with **only infrastructure edits** (server URLs, storage
locations) — the models, channels, and purposes are identical:

- `domain/contracts/api/behaviour-service.openapi.yaml` — the HTTP surface (source of truth)
- `domain/contracts/api/behaviour-service.asyncapi.yaml` — the event channel
- `domain/contracts/data/colour-operational.contract.yaml` — raw JSONL product (operational awareness)
- `domain/contracts/data/colour-performance.contract.yaml` — curated Parquet product (performance)
- `domain/events/colour.generated.schema.json` — CloudEvent payload schema
