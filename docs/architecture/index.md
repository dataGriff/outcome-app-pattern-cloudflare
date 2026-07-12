# Architecture

The [outcome-app-pattern](https://github.com/dataGriff/outcome-app-pattern) — a
**source-aligned, API-first, multichannel domain** — rebuilt on Cloudflare's free plan as a
**per-user todo-list domain**. The structure is unchanged from the source: the three zones, the
naming rules, and the contract-first order of work all carry over. Two things are deliberately
swapped: the implementations behind the role names (containers → Cloudflare primitives), and the
domain itself (the source's global colour domain → todos with per-user state) — proving the
pattern generalises across both axes.

## The pattern

The logical shape, independent of any platform — the same topology as the
[source repo](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/architecture/index.md),
with this repo's domain in the boxes:

```mermaid
flowchart TB
  user([POST /todos]) --> api
  subgraph domain["domain/ — the source-aligned core"]
    api[Todo API]
    store[("Operational store<br/>per-user todos + outbox")]
    relay[Relay]
    api -->|one transaction| store --> relay
  end
  subgraph platform["platform/ — infrastructure + analytics"]
    events{{Event broker}}
    streaming[Streaming]
    raw[("Object storage<br/>todo-operational · raw")]
    summariser[Summariser]
    curated[("Object storage<br/>todo-performance · curated")]
    viz[Visualisation]
    events --> streaming --> raw --> summariser --> curated --> viz
  end
  subgraph experiences["experiences/ — one API, many channels"]
    web[web]
    mobile[mobile]
    agent[agent]
  end
  relay -->|todo.* events| events
  events -. per-user SSE bridge .-> api
  web & mobile & agent -->|call the one API as the user| api
  api -. live per-user SSE .-> experiences
```

## The three zones

| Zone | Owns |
| --- | --- |
| `domain/` | The todo Worker, the D1 operational store (todos keyed by user) + outbox, the relay Durable Object, all contracts, and the event schema. |
| `experiences/` | One directory per channel — `web`, `mobile`, `agent` — each consuming the one API as the authenticated caller. See [experiences](../experiences/index.md). |
| `platform/` | The queue consumer (→ raw JSONL, title stripped), the summariser (→ curated Parquet), and the visualisation page. See [data products](../data-products/index.md). |

## This implementation

The same pattern, realised on Cloudflare — identical topology to [the pattern](#the-pattern)
above, concrete primitives in each box (Workers, D1, Queues, R2, …). The relay fans out to the
Queue **and** to one `StreamDO` per user (`idFromName(user_id)`), so each live SSE feed carries
only its owner's events — isolation by construction:

```mermaid
flowchart TB
  user([POST /todos]) --> api
  subgraph domain["domain/ — the source-aligned core"]
    api["Todo API<br/>Worker · Hono"]
    store[("D1<br/>todos (per user) + outbox · atomic batch()")]
    relay["Relay<br/>OutboxRelayDO · alarms"]
    api -->|one transaction| store --> relay
  end
  subgraph platform["platform/ — infrastructure + analytics"]
    events{{"Queue · todo-events"}}
    streaming["Streaming<br/>queue consumer · strips title"]
    raw[("R2<br/>todo-operational · JSONL")]
    summariser["Summariser<br/>cron scheduled()"]
    curated[("R2<br/>todo-performance · Parquet")]
    viz["Visualisation<br/>static page + /products/*"]
    events --> streaming --> raw --> summariser --> curated --> viz
  end
  subgraph experiences["experiences/ — one API, many channels"]
    web["web · todo-web Worker"]
    mobile["mobile · Expo/RN"]
    agent["agent · todo-agent · MCP http"]
  end
  relay -->|todo.* events| events
  events -. "per-user SSE · StreamDO per user" .-> api
  web & mobile & agent -->|call the one API as the user| api
  api -. live per-user SSE .-> experiences
```

Every role keeps its name; only the implementation underneath is swapped (role-named bindings,
honest implementation names in `wrangler.jsonc`):

| Pattern role | Source implementation | Cloudflare implementation |
| --- | --- | --- |
| behaviour API | FastAPI | `todo-behaviour-service` Worker (Hono) |
| operational-store | Postgres | D1 `todo` — per-user rows; one atomic `batch()` is the outbox transaction |
| relay | asyncpg loop | `OutboxRelayDO` Durable Object (poke on write + alarm backstop + prune) |
| events | NATS | Queue `todo-events` |
| SSE bridge | in-API NATS subscriber | `StreamDO` Durable Object **per user** (SSE fan-out, routed by `data.user_id`) |
| streaming | bento | queue consumer → JSONL to R2 (strips the todo title — no user content in the analytical layer) |
| object-storage | SeaweedFS (S3) | R2 bucket `todo-data` |
| summariser | pandas loop | cron `scheduled()` → Parquet |
| visualisation | Streamlit | static page + `/products/*` read endpoints |
| web experience | Flask | `todo-web` Worker (static assets + same-origin proxy, JWT forwarded on every call) |
| mobile experience | Expo/React Native | unchanged (points at the deployed API; bearer-auth SSE reader) |
| agent experience | MCP server (stdio) | `todo-agent` Worker (MCP over streamable-http, caller JWT forwarded) |
| identity (port addition) | — (source is open) | Cloudflare Access issues JWTs; every Worker validates them with the shared `access-jwt` verifier, and the domain scopes every row to the caller's `sub`. See [security](../security/index.md). |

## What the platform swap forced

The interesting decisions a serverless port makes — D1 can't share a DB clock so the app
supplies the one shared outbox timestamp; the relay is a Durable Object with alarms rather than
an always-on loop; Queues are single-consumer so the relay fans out itself (queue for the data
product + best-effort per-user SSE broadcast). The full analysis lives in the source repo's
[replication guide](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/replication/index.md),
which this repo was the dry run for (see [replication](../replication/index.md)).

**What the domain swap forced.** Per-user state pulls identity into the domain: every query is
scoped `WHERE user_id = ?` (the Access `sub`), auth moves from one write endpoint to every
route (with a fixed dev identity while Access is unprovisioned), the SSE bridge becomes one
Durable Object per user instead of a singleton, and the analytical layer has to take a PII
stance (event snapshots carry the title for live UI only; the consumer strips it before the
10-year-retention products).

The **platform zone also collapses to one Worker.** The source repo splits `platform/` into
separate container services — `streaming/` (bento), `storage/` (SeaweedFS), `analytics/summariser`
and `analytics/visualisation` (Streamlit). Here the streaming consumer (`queue()`), the summariser
(`scheduled()` cron), the products read surface, and the static visualisation all live in the one
`todo-data-products` Worker, sharing the R2 binding and deploying together. There is **no
`platform/storage/`** — R2 is managed (created by `task bootstrap:cloud`), and the operational
store's schema lives in D1 migrations under `domain/`, not the platform zone. Same roles (they're
all in the mapping above), fewer moving parts.
