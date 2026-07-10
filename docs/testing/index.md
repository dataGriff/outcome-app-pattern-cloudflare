# Testing

Two layers: a hermetic suite that runs pre-deploy, and the real `datacontract test` that runs
post-deploy against R2. Together they are the drift gates — keep them green.

## Hermetic suite (`task ci`)

Runs with no cloud dependencies, the one command agents, developers, and CI all invoke:

- **Contract lints** — the OpenAPI, AsyncAPI, and data contracts.
- **Generated-types staleness** — the typed client is regenerated and must match what's
  committed.
- **Typecheck** — across the four Workers + the mobile app.
- **Unit / integration / data-product / agent tests** — including the queue consumer landing
  partitioned JSONL, the summariser's per-day Parquet + day-sealing + watermark, and the agent's
  MCP tools.
- **Schemathesis** — conformance of the running Worker against the committed OpenAPI, via
  `wrangler dev`.

The structural data-product test is the hermetic stand-in for `datacontract test`: local R2 has
no S3 endpoint, so the real contract test runs post-deploy (below).

## Post-deploy verification (CI `verify` job)

After `task deploy`, CI smoke-tests the **deployed** stack end to end — generate ×3, latest, the
SSE feed within the relay alarm window, cross-process queue delivery to the operational product,
and the Parquet summariser — then runs the real **`datacontract test`** against both products
over R2's S3 API (the endpoint is declared in each contract). See
[deployment](../deployment/index.md).
