# Contracts

Authored and owned **in this repo** — the todo domain deliberately diverges from the source
repo's colour domain, so these contracts are the source of truth here, not copies. The
implementation is kept conformant to them; the drift gates are in [testing](../testing/index.md).

- `domain/contracts/api/todo-service.openapi.yaml` — the HTTP surface (source of truth): CRUD on
  `/todos` plus the authenticated per-user SSE feed. Server handler types and the mobile typed
  client are both generated from it (`task gen:types`).
- `domain/contracts/api/todo-service.asyncapi.yaml` — the event channel: one snapshot-shaped
  `TodoEvent` message with a `type` discriminant (`todo.created` / `todo.updated` /
  `todo.completed` / `todo.deleted`). The snapshot carries the origin dimensions: `channel`
  (which experience performed the mutation — `web`/`mobile`/`agent`/`api`, self-declared via
  the `X-Channel` request header) and `is_test` (declared via `X-Test`).
- `domain/contracts/data/todo-operational.contract.yaml` — raw JSONL product (operational
  awareness): `{event_type, todo_id, user_id, timestamp, channel, is_test}`. Deliberately
  excludes the todo title and any email — no PII in the long-retention layer. Storage location
  `s3://todo-data/todo-operational/**/*.jsonl`.
- `domain/contracts/data/todo-performance.contract.yaml` — curated Parquet product
  (created-vs-completed per day, split by channel and traffic kind):
  `{date, event_type, channel, is_test, count}`. Storage location
  `s3://todo-data/todo-performance/**/*.parquet`.
- `domain/events/todo-event.schema.json` — CloudEvent payload schema (the authoritative copy
  also lives inline in the AsyncAPI contract).

The two data contracts are verified against the real R2 objects with `datacontract test`
post-deploy (over R2's S3 API — the endpoint is declared in each contract). For the deeper
rationale on contract-first and evolution, see the source repo's
[contracts guide](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/contracts/index.md).
