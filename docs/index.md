# Documentation

The canonical topic index for this repo — for humans and agents alike. Entry files
(`README.md`, `AGENTS.md`) route here; each topic below owns its subject in
`docs/{topic}/index.md`, where the detailed documentation is kept.

| Topic | What it covers |
| --- | --- |
| [Architecture](architecture/index.md) | The pattern, the three zones, and the role → Cloudflare-primitive mapping. |
| [Contracts](contracts/index.md) | The OpenAPI, AsyncAPI, and data contracts (copied from the source with infra-only edits). |
| [Development](development/index.md) | Local dev (multi-process `wrangler dev`), the Taskfile, and conventions. |
| [Testing](testing/index.md) | The hermetic suite and the post-deploy `datacontract test` against R2. |
| [Data products](data-products/index.md) | The R2 storage model — bronze/silver, day-sealing, and the incremental summariser watermark. |
| [Experiences](experiences/index.md) | The web, mobile, and agent channels — and how to interact with the deployed MCP agent. |
| [Security](security/index.md) | Authentication — Cloudflare Access + the shared JWT verifier across all four Workers and the mobile app. |
| [Deployment](deployment/index.md) | One-time cloud setup, GitHub secrets/vars, and the CI deploy + verify flow. |
| [Productionising](productionising/index.md) | Pointer to the source repo's production-readiness checklist. |
| [Replication](replication/index.md) | This port *is* the replication dry-run — pointer to the source repo's lift-out guide. |
