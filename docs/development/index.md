# Development

How this repo is worked on locally. The build order and conventions follow the source repo's
[development guide](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/development/index.md);
this page covers what is specific to the Cloudflare port.

## Run it locally

One command brings up all four Workers, each on its own port, wired by Wrangler's local dev
registry — service bindings **and** cross-process queue delivery:

```bash
npm ci
task up      # domain :8787  data-products :8788  web :8789  agent :8790
```

Then open the web channel at http://localhost:8789, run the mobile app with `task run:mobile`,
or point an MCP client at http://localhost:8790/mcp (see [experiences](../experiences/index.md)).

## Multi-process dev

Each Worker runs its **own** `wrangler dev` on a distinct `--port` *and* `--inspector-port` — a
single multi-config dev process binds only one HTTP port, so the channels run as separate
processes. The local dev registry still carries both service bindings and cross-process queue
delivery between them, so the stack behaves like the deployed topology.

## Conventions

- **Contract-first, test-driven, conventional commits** — as in the source pattern.
- **One Taskfile.** Any repetitive command CI also needs lives in `Taskfile.yml`, so agents,
  developers, and CI run the same thing. `task ci` runs the whole hermetic suite (contract
  lints, generated-types staleness, typecheck across the four Workers + mobile, unit /
  integration / data-product / agent tests, and Schemathesis vs `wrangler dev`). Deploy is
  `task deploy` — see [deployment](../deployment/index.md).
- **Role-named bindings, honest implementation names** in `wrangler.jsonc` (see
  [architecture](../architecture/index.md#this-implementation)).
