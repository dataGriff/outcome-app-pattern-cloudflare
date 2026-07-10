# Contracts

Copied from the source repo with **only infrastructure edits** (server URLs, storage
locations) — the models, channels, and purposes are identical. The implementation is kept
conformant to them; the drift gates are in [testing](../testing/index.md).

- `domain/contracts/api/behaviour-service.openapi.yaml` — the HTTP surface (source of truth).
- `domain/contracts/api/behaviour-service.asyncapi.yaml` — the event channel.
- `domain/contracts/data/colour-operational.contract.yaml` — raw JSONL product (operational
  awareness). Its storage location points at `s3://colour-data/colour-operational/**/*.jsonl`.
- `domain/contracts/data/colour-performance.contract.yaml` — curated Parquet product
  (performance). Storage location `s3://colour-data/colour-performance/**/*.parquet`.
- `domain/events/colour.generated.schema.json` — CloudEvent payload schema.

The two data contracts are verified against the real R2 objects with `datacontract test`
post-deploy (over R2's S3 API — the endpoint is declared in each contract). For the deeper
rationale on contract-first and evolution, see the source repo's
[contracts guide](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/contracts/index.md).
