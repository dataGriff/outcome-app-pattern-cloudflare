# Data products

The raw operational product is the durable **system of record** — kept forever, never
re-scanned wholesale. Both products live in the one `todo-data` R2 bucket.

Both are **deliberately PII-free**: the queue consumer lands
`{event_type, todo_id, user_id, timestamp}` by explicit field picks, so the transported todo
title (user content) structurally cannot reach this 10-year-retention layer, and `user_id` is
the opaque Cloudflare Access `sub` claim — never an email. The curated product aggregates
across users to `{date, event_type, count}` (the created-vs-completed burn-up). The hermetic
suite and the CI verify job both assert the no-title bar.

## Storage layout

```
todo-operational/dt=YYYY-MM-DD/<ts>-<id>.jsonl   # bronze — immutable, date-partitioned
todo-operational/dt=YYYY-MM-DD/part-0000.jsonl   #   sealed day, fragments compacted to one
todo-performance/dt=YYYY-MM-DD/part.parquet      # silver — per-day curated Parquet
_state/summariser.json                             # watermark: { "sealedThrough": "YYYY-MM-DD" }
```

## The incremental summariser

The summariser is **incremental**: each run recomputes only the open window (today + a grace
day — `SUMMARISER_OPEN_DAYS`, default 2), then seals each closed day exactly once:

1. writes its per-day Parquet under `todo-performance/dt=…/`,
2. compacts its raw fragments to a single `part-0000.jsonl`,
3. advances the watermark in `_state/summariser.json`.

Sealed days are **never listed or read again**, so per-run work is bounded regardless of how
large the archive grows. Analytical reads hit the curated per-day Parquets (and the recent
operational window); the full archive is an occasional audit read straight from R2.

## Cold tiering (paid lever)

Cold-tiering sealed partitions to **R2 Infrequent Access** via a lifecycle rule is the paid
production lever. The free plan does the tiering *logically* — a sealed partition is simply one
you don't read. This is the platform-agnostic upgrade the port fed back into the source pattern
(see [replication](../replication/index.md)).

## Table-format storage (Iceberg — scale lever)

Iceberg is **not a replacement for Parquet** — it's a *table format* layered on top of it (an
Iceberg table's data files are Parquet). Cloudflare exposes it as **R2 Data Catalog** (a managed
Apache Iceberg REST catalog over R2) plus **R2 SQL**. Over bare Parquet files it adds ACID
snapshots, schema/partition evolution, time travel, and multi-engine reads (DuckDB, Spark,
PyIceberg, …) with catalog-level partition pruning.

This demo keeps **plain Parquet**: the curated product is tiny per-day aggregates with a single
reader and no query engine, and the summariser Worker writes Parquet directly — whereas Iceberg
writes want a compute engine (PyIceberg / Spark) or Cloudflare Pipelines to commit the
manifests/snapshots, which a Worker can't do natively. Reach for Iceberg when the curated product
grows to large, long-history, multi-consumer analytics that need ACID appends and external-engine
queries. It's the grown-up form of the [incremental summariser](#the-incremental-summariser) above:
each sealed day here is, in effect, an Iceberg snapshot-per-commit with a hand-rolled watermark.
