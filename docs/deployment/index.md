# Deployment

Deploy is a single `task deploy` (remote D1 migrations, then domain → platform → web → agent, so
the experiences' service bindings resolve against an already-live domain), run automatically by
CI on push to `main`.

## One-time cloud setup

1. **Enable R2** once in the Cloudflare dashboard (the free tier still requires the initial
   opt-in), then `task bootstrap:cloud` to create the `todo` D1 database, the `todo-events`
   queue, and the `todo-data` bucket. Paste the printed D1 `database_id` into
   `domain/api/wrangler.jsonc`.
2. **GitHub secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and a read-only R2 S3 key
   pair (`R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY`) scoped to `todo-data` for the
   post-deploy `datacontract test`.
3. **GitHub variable:** `WORKERS_SUBDOMAIN` (your `*.workers.dev` subdomain) so the verify job can
   reach the deployed channels.

## CI flow

On push to `main`: `test` (the hermetic `task ci`) → `deploy` (`task deploy`) → `verify`. The
**verify** job smoke-tests the deployed stack end to end as the dev fallback identity — create
×3, list, PATCH to completed, the per-user SSE feed (with the duplicate-broadcast race check),
cross-process queue delivery to the operational product **with the no-`title` PII assertion**,
and the Parquet summariser — and runs the real `datacontract test` against both products over
R2's S3 API. See [testing](../testing/index.md). Once Access is enforced the smoke needs a
service token — see [productionising](../productionising/index.md).

## Live channels

Once deployed (subdomain = `WORKERS_SUBDOMAIN`):

- `https://todo-behaviour-service.<subdomain>.workers.dev` — the domain API
- `https://todo-data-products.<subdomain>.workers.dev` — products + visualisation
- `https://todo-web.<subdomain>.workers.dev` — the web channel
- `https://todo-agent.<subdomain>.workers.dev/mcp` — the MCP agent (see
  [experiences](../experiences/index.md#interacting-with-the-deployed-agent))

The custom domains (`todo-api` / `todo-data` / `todo-web` / `todo-agent` on `domainapps.org`)
are declared in each `wrangler.jsonc` and created automatically on deploy once the zone is
active — they're the hostnames the Access apps front. See [security](../security/index.md).

## Authentication

Identity is **Cloudflare Access** — config-gated and inert until provisioned: while `ACCESS_AUD`
is unset every request acts as the fixed dev identity, so the deployed demo works tokenless (as
one shared user). Every Worker validates Access's JWT with one shared verifier; the whole todo
surface, the MCP endpoint, and the data-products read surface all enforce it once you set
`ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`. Full model, the per-hostname Access apps on
`domainapps.org`, and the one-time Zero Trust setup are in [security](../security/index.md). The
rate limiting and Turnstile below are the *cost* guards that apply whether or not auth is on.

## Abuse protection (rate limiting)

The **write** endpoints — `POST /todos`, `PATCH /todos/{id}`, `DELETE /todos/{id}` — each drive
an outbox row and, downstream, R2 writes and storage, so they're guarded against abuse. Two
native [Workers rate limiters](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
(free, in-memory per-colo) sit in front of them, in `domain/api`:

- **`RL_PER_IP`** — 10 requests/min per caller: keyed by `cf-connecting-ip` for direct external
  requests (Cloudflare sets it unspoofably), and by the authenticated user's `sub` for
  first-party service-binding traffic (web/agent), so one user can't flood a channel while
  distinct users aren't throttled collectively.
- **`RL_GLOBAL`** — 60 requests/min account-wide: the **wallet ceiling** against distributed abuse
  (per-caller limits don't stop many callers). When either trips, the endpoint returns a
  contract-documented **429** with `Retry-After`.

Reads (`GET /todos`, `GET /todos/{id}`, `/events/stream`) are unlimited — they don't write.
Enforcement is gated by the `RATE_LIMIT` var: `"on"` in `wrangler.jsonc` (deployed), overridden to
`"off"` for local `wrangler dev` (the Schemathesis run passes `--var RATE_LIMIT:off`) and in vitest,
so the hermetic gates aren't throttled. The limits live in `domain/api/wrangler.jsonc`
(`unsafe.bindings`); tune them there. WAF/dashboard rate-limiting rules don't apply to
`*.workers.dev`, so this is enforced in-Worker.

Every channel surfaces the 429 to its user: web/mobile show a "rate limited — try again in Ns"
notice (the API exposes `Retry-After` via CORS so the cross-origin mobile channel can read it), and
the agent tool returns an `isError` result telling the model to back off.

For a stricter, globally-consistent limit you'd move to a Durable Object token bucket.

## Bot protection (Turnstile)

Rate limiting bounds *cost*; [Turnstile](https://developers.cloudflare.com/turnstile/) keeps casual
bots off the public **web** UI. The web worker verifies a Turnstile token before it forwards a
todo creation to the domain API — it's **config-gated and inert until you provision keys**:

1. Create a Turnstile widget in the Cloudflare dashboard (Turnstile → Add site) for your web
   channel's hostname. You get a **sitekey** (public) and a **secret** (private).
2. Put the sitekey in `experiences/web/public/index.html` (replace the always-pass **test** sitekey
   `1x00000000000000000000AA` in the `cf-turnstile` widget).
3. Set the secret on the web worker: `wrangler secret put TURNSTILE_SECRET -c experiences/web/wrangler.jsonc`.

With the secret set, the worker calls Cloudflare's siteverify and returns **403** on failure (the
UI shows "bot check failed — please retry"). Unset, the widget still renders but nothing is enforced,
so the demo runs without keys.

**Scope, honestly:** Turnstile only guards the web channel's create. It can't gate the **agent**
(an LLM can't solve a challenge) or native **mobile**, and a bot can still hit
`todo-behaviour-service.<subdomain>.workers.dev/todos` **directly**, bypassing the web worker.
So the **rate limiter above remains the real cost ceiling** — Turnstile just removes low-effort UI
bot traffic. Once Access is enforced, unauthenticated bots are cut off entirely.

## Cost alerting (billing usage alert)

A backstop so runaway usage reaches you before the bill does. This is a **dashboard action** (there's
no in-repo IaC for it):

1. Cloudflare dashboard → **Notifications** → **Add** → **Billing** (usage/spend) notification, and
   set a threshold with your email/webhook.
2. Watch the free-tier ceilings the write path pushes against:
   [R2](https://developers.cloudflare.com/r2/pricing/) (10 GB storage, 1M Class A ops/mo free —
   storage is the unbounded one, since every event is retained as the system of record) and
   [Workers](https://developers.cloudflare.com/workers/platform/limits/) (100k requests/day free).
3. Optionally add per-service R2 storage/ops notifications so a spike in `todo-data` is flagged
   directly.
