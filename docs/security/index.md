# Security — authentication & the per-user model

Identity for this pattern is **Cloudflare Access**: it hosts the login UI, brokers the identity
provider (Google / GitHub / email OTP — all free on Zero Trust, ≤50 users), and mints signed JWTs
for both humans (login) and machines (service tokens). Every Worker validates that JWT with **one
shared module** — `shared/access-jwt` (`verifyAccessJwt`) — against Access's public JWKS.

The domain is **per-user**: every todo row is owned by the caller (`user_id` = the Access `sub`
claim), every query is scoped `WHERE user_id = ?`, and the live SSE feed is one Durable Object
per user. Identity is therefore not an add-on guard but the row key.

Auth is **config-gated like rate limiting and Turnstile** — with one important difference from
a simple on/off. With `ACCESS_AUD` unset the verifier returns `disabled` and every request acts
as the fixed **dev identity** `{ sub: "dev", email: "dev@localhost" }` (`DEV_IDENTITY` in
`shared/access-jwt`), so the hermetic suite (`task ci`) and local `wrangler dev` need no tokens
while still exercising the per-user code paths. Setting the two vars per Worker turns real
enforcement on: a missing or invalid token is then **always 401** on every todo endpoint —
there is no trusted-transport pass-through, because per-user data requires an identity, not
transport trust. First-party channels must forward the caller's JWT over their service binding
(web and agent both do).

## Prerequisite — a custom domain (already owned: `domainapps.org`)

Access applications attach **per hostname in a zone you control**; `*.workers.dev` can't host one.
Add `domainapps.org` as a Cloudflare zone (free) and put each Worker on a subdomain, then create one
Access application per hostname. Zone, Access (≤50 users), and Worker custom domains are all free —
the only cost is owning the domain, which you already do.

| Worker | Hostname | Access application |
| --- | --- | --- |
| `todo-behaviour-service` | `todo-api.domainapps.org` | Self-hosted (+ a service token for direct/machine callers) |
| `todo-web` | `todo-web.domainapps.org` | Self-hosted (end-user login) |
| `todo-agent` | `todo-agent.domainapps.org` | Self-hosted, OIDC — the OAuth provider MCP clients authenticate against |
| `todo-data-products` | `todo-data.domainapps.org` | Self-hosted (gates the read surface) |

## The one seam — `shared/access-jwt`

`verifyAccessJwt(request, { teamDomain, aud }, key?)` returns `disabled` (auth off), `ok` (with the
caller's `{ email, sub }`), or `unauthorized` (with a `missing`/`invalid` reason). It reads the token
from the edge-injected `Cf-Access-Jwt-Assertion` header or an `Authorization: Bearer` token, and
verifies signature, `iss` (the team domain), `aud` (the app tag) and expiry. `key` is injectable so
the unit tests verify against a locally-signed key with no network. The module also exports
`DEV_IDENTITY` — the one fixed identity every enforcement point falls back to while auth is
disabled (policy lives at the enforcement points; the verifier stays pure). Issuer-agnostic by
construction: swapping Access for another OIDC provider (e.g. Supabase) later changes only
`teamDomain`/`aud` and the JWKS URL — every enforcement point below stays put.

## Where it's enforced

- **Domain API (`domain/api`).** `requireAuth` guards **every route** — all five `/todos`
  operations and the per-user `GET /events/stream` (only `/openapi.json` and `/docs` stay open).
  It runs before the rate limiter, so an unauthorised caller spends no budget, and it resolves
  the identity the handlers scope their SQL by (`identity.sub → user_id`, the seam the
  user-isolation test locks down). With Access enabled there is no unauthenticated path:
  service-binding callers with no token get 401 like anyone else — the web and agent channels
  forward the caller's JWT. The rate limiter buckets direct callers by `cf-connecting-ip` and
  service-binding callers by the authenticated `sub`. The contract documents the scheme:
  `securitySchemes` (`accessJwt`, `bearerAuth`) + a `401` on every operation.
- **Web (`experiences/web`).** Behind an Access self-hosted app: Access renders the login page and
  injects the JWT (no login UI to build). The worker validates it on `/api/*` (defence in depth) and
  forwards `Cf-Access-Jwt-Assertion` to the domain on **every** proxied call — including the SSE
  stream, which identifies whose feed to serve.
- **Mobile (`experiences/mobile`).** A native app can't ride the browser cookie, so `src/auth.ts`
  runs the Access **OIDC** flow (`expo-auth-session`, OAuth + PKCE, system browser) and attaches the
  token as a bearer — via an `openapi-fetch` middleware for HTTP, and via the fetch-streaming SSE
  reader (`src/sse.ts`) for the live feed (`EventSource` can't send headers). Gated on
  `EXPO_PUBLIC_ACCESS_*` — inert in the open demo.
- **Agent (`experiences/agent`).** `/mcp` and `/sse` are gated at the fetch boundary: with the
  hostname behind Access acting as the **OAuth provider**, MCP clients (Claude, MCP Inspector, the AI
  Playground) complete the browser auth flow and present the resulting JWT, which the worker
  validates — then captures into the session (`ctx.props`) and **forwards on every domain call**,
  so the tools act on the caller's own todos.
- **Data products (`platform/data-products`).** A Hono middleware guards `/products/*` and
  `/run/summarise`; the visualisation page itself is gated at the edge by Access. The products
  themselves are PII-free by construction (see [data products](../data-products/index.md)).

## One-time Zero Trust setup

1. Add `domainapps.org` as a zone; point each Worker at its subdomain (Workers → *worker* → Custom
   Domains, or a route).
2. Zero Trust → Access → Applications: create one application per hostname above, pick an identity
   provider, and set an access policy (the allow-list — this is why it's *gated* access, not open
   consumer signup). Each app has an **Audience (AUD) tag**.
3. For the domain's direct/machine callers, create a **service token** (Access → Service Auth) and add
   a policy that accepts it. Note the caveat: service-token JWTs carry an **empty `sub`**, so a
   machine caller has no per-user identity — see [productionising](../productionising/index.md).
4. Set the vars per Worker (neither is secret): `ACCESS_TEAM_DOMAIN`
   (`https://<team>.cloudflareaccess.com`) and `ACCESS_AUD` (that app's tag). For mobile, set
   `EXPO_PUBLIC_ACCESS_TEAM_DOMAIN` and `EXPO_PUBLIC_ACCESS_CLIENT_ID`.

Validation needs only public material (JWKS + team domain + AUD tag), so **no secret lands in Worker
code**.

## Scope, honestly

- Access is **gated access** (allow-listed / invited identities via a policy), not self-serve
  consumer signup. Right for a reference; if the real product later needs public signups, swap the
  `verifyAccessJwt` seam to a consumer IdP — enforcement points, the forwarded-JWT flow, the
  `sub → user_id` mapping, and the contract are unchanged.
- The custom-domain prerequisite is a setup step, not a recurring cost.
- This layer is **authentication + row-level ownership**: every row is scoped to the caller's
  `sub`, and a missing todo is indistinguishable from another user's (404 either way — ids never
  leak across users). There is still no *sharing* or role model — one user, one silo.
- Until the Access apps are provisioned every caller is the same dev identity, so the deployed
  demo behaves like a single shared list. That is the config gate working as designed — set the
  vars to get real per-user isolation.
