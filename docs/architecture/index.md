# Architecture

The [outcome-app-pattern](https://github.com/dataGriff/outcome-app-pattern) — a
**source-aligned, API-first, multichannel domain** — ported to Cloudflare's free plan. The
structure is unchanged from the source: the three zones, the naming rules, and the
contract-first order of work all carry over; only the implementations behind the role names
are swapped.

## The three zones

| Zone | Owns |
| --- | --- |
| `domain/` | The behaviour Worker, the D1 operational store + outbox, the relay Durable Object, all contracts, and the event schema. |
| `experiences/` | One directory per channel — `web`, `mobile`, `agent` — each consuming the one API. See [experiences](../experiences/index.md). |
| `platform/` | The queue consumer (→ raw JSONL), the summariser (→ curated Parquet), and the visualisation page. See [data products](../data-products/index.md). |

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

## What the platform swap forced

The interesting decisions a serverless port makes — D1 can't share a DB clock so the app
supplies the one shared outbox timestamp; the relay is a Durable Object with alarms rather than
an always-on loop; Queues are single-consumer so the relay fans out itself (queue for the data
product + best-effort SSE broadcast). The full analysis lives in the source repo's
[replication guide](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/replication/index.md),
which this repo was the dry run for (see [replication](../replication/index.md)).
