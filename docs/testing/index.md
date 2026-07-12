# Testing

Two layers: a hermetic suite that runs pre-deploy, and the real `datacontract test` that runs
post-deploy against R2. Together they are the drift gates — keep them green.

## Hermetic suite (`task ci`)

Runs with no cloud dependencies, the one command agents, developers, and CI all invoke. Access
is unprovisioned in the suite, so every request acts as the fixed dev identity — the per-user
code paths run exactly as they do in production, just with one known user.

- **Contract lints** — the OpenAPI, AsyncAPI, and data contracts.
- **Generated-types staleness** — the typed client is regenerated and must match what's
  committed.
- **Typecheck** — across the four Workers + the mobile app.
- **Unit / integration / data-product / agent tests** — full CRUD behaviour, the event contract
  per mutation type (including the origin dimensions: declared `X-Channel`/`X-Test` flow into
  the event, unrecognised channels record as `api`), the queue consumer landing partitioned
  JSONL **with the todo title stripped** and the origin fields kept, the summariser's per-day
  Parquet split by `(event_type, channel, is_test)` + day-sealing + watermark, and the agent's
  MCP tools (whose mocked domain rejects calls without the forwarded Access JWT or the
  `x-channel: agent` declaration).
- **User isolation** (`user-isolation.test.ts`) — alice and bob at the db seam: list / get /
  patch / delete never cross users. HTTP-level cross-user tests aren't possible hermetically
  (a second identity would need a real Access JWT and remote JWKS), but every handler maps
  identity to data through exactly one seam — `identity.sub → user_id` in `src/db.ts` — so
  locking that seam down covers the property.
- **Stream routing** (`stream-routing.test.ts`) — a mixed-user outbox is drained and each
  user's SSE stream must carry only their own frames (the relay routes by `data.user_id` to a
  per-user `StreamDO`).
- **Schemathesis** — conformance of the running Worker against the committed OpenAPI, via
  `wrangler dev`, now fuzzing the POST/PATCH bodies and the `/todos/{id}` path parameter too.
  (`schemathesis.toml` disables one false-positive check on `GET /todos`: negative-mode scalar
  query params serialise identically to valid ones, so "negative data rejection" can't be
  meaningfully probed there — the real negative cases are asserted in the unit suite.)

The structural data-product test is the hermetic stand-in for `datacontract test`: local R2 has
no S3 endpoint, so the real contract test runs post-deploy (below).

## Post-deploy verification (CI `verify` job)

After `task deploy`, CI smoke-tests the **deployed** stack end to end as the dev fallback
identity, declaring `X-Test: true` on every write so smoke traffic lands marked as test —
create ×3 (asserting the contract shape), list, PATCH to completed (asserting
`completed_at`), the per-user SSE feed within the relay alarm window (including the
duplicate-broadcast race check), cross-process queue delivery to the operational product **with
an explicit no-`title`-field assertion (the PII gate) and an `is_test`/`channel` origin
assertion**, and the Parquet summariser — then runs
the real **`datacontract test`** against both products over R2's S3 API (the endpoint is
declared in each contract). See [deployment](../deployment/index.md).

Once `ACCESS_AUD` is set in production the smoke needs an Access service token — see the
caveat in [productionising](../productionising/index.md).
