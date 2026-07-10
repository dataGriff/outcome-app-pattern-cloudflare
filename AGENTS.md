# AGENTS.md

The canonical working agreement for anyone — human or agent — changing this repo.
Keep it thin: durable rules live here, everything else routes through
[`docs/index.md`](docs/index.md).

## What this repo is

The [outcome-app-pattern](https://github.com/dataGriff/outcome-app-pattern) reference — a
**source-aligned, API-first, multichannel domain** — ported to run entirely on **Cloudflare's
free plan**, in TypeScript. Same pattern, same colour domain, same contracts; only the
platform changes. `domain/` owns the behaviour Worker + contracts + events; `experiences/`
(web, mobile, agent) consume the one API; `platform/` runs the queue consumer, summariser, and
visualisation. This repo is also the first dry run of the source repo's replication guide. See
[`docs/architecture/`](docs/architecture/index.md).

## Working agreement

- **Contract-first.** The contracts in `domain/contracts/` are copied from the source repo with
  only infrastructure edits (server URLs, storage locations). Keep the implementation conformant
  to them. See [`docs/contracts/`](docs/contracts/index.md).
- **Test-driven.** The hermetic suite plus the post-deploy `datacontract test` are the drift
  gates — keep them green. See [`docs/testing/`](docs/testing/index.md).
- **One `task ci` / `task deploy`.** Agents, developers, and CI run the *same* Taskfile targets
  — never duplicate a lint/test/build/deploy command across contexts.
- **Multi-process local dev.** Each Worker runs its own `wrangler dev` on a distinct
  `--port`/`--inspector-port`; `task up` wires them via the local dev registry. See
  [`docs/development/`](docs/development/index.md).
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`).
- **Role-named bindings, honest implementation names** in `wrangler.jsonc` — see the role
  mapping in [`docs/architecture/`](docs/architecture/index.md).

## Documentation hub

All topics live in **[`docs/index.md`](docs/index.md)** — route through it. Entry files (this
one, `README.md`) stay thin and point there; the fanned-out documentation lives in
`docs/{topic}/index.md`.

## Keeping docs correct

When something changes, update the matching topic so the docs stay true:

| You changed… | Update… |
| --- | --- |
| A role → Cloudflare primitive mapping, or the zones | [`docs/architecture/`](docs/architecture/index.md) |
| A contract | [`docs/contracts/`](docs/contracts/index.md) |
| Local dev, ports, or a Taskfile target | [`docs/development/`](docs/development/index.md) |
| A test or conformance gate | [`docs/testing/`](docs/testing/index.md) |
| The R2 storage layout / summariser / watermark | [`docs/data-products/`](docs/data-products/index.md) |
| A channel (web / mobile / agent) or the deployed agent's endpoints | [`docs/experiences/`](docs/experiences/index.md) |
| The deploy flow, cloud setup, or CI secrets/vars | [`docs/deployment/`](docs/deployment/index.md) |
