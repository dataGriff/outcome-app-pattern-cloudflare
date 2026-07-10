# Deployment

Deploy is a single `task deploy` (remote D1 migrations, then domain → platform → web → agent, so
the experiences' service bindings resolve against an already-live domain), run automatically by
CI on push to `main`.

## One-time cloud setup

1. **Enable R2** once in the Cloudflare dashboard (the free tier still requires the initial
   opt-in), then `task bootstrap:cloud` to create the D1 database, the queue, and the
   `colour-data` bucket.
2. **GitHub secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and a read-only R2 S3 key
   pair (`R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY`) for the post-deploy `datacontract test`.
3. **GitHub variable:** `WORKERS_SUBDOMAIN` (your `*.workers.dev` subdomain) so the verify job can
   reach the deployed channels.

## CI flow

On push to `main`: `test` (the hermetic `task ci`) → `deploy` (`task deploy`) → `verify`. The
**verify** job smoke-tests the deployed stack end to end — generate, latest, the SSE feed,
cross-process queue delivery to the operational product, the Parquet summariser — and runs the
real `datacontract test` against both products over R2's S3 API. See [testing](../testing/index.md).

## Live channels

Once deployed (subdomain = `WORKERS_SUBDOMAIN`):

- `https://colour-behaviour-service.<subdomain>.workers.dev` — the domain API
- `https://colour-data-products.<subdomain>.workers.dev` — products + visualisation
- `https://colour-web.<subdomain>.workers.dev` — the web channel
- `https://colour-agent.<subdomain>.workers.dev/mcp` — the MCP agent (see
  [experiences](../experiences/index.md#interacting-with-the-deployed-agent))
