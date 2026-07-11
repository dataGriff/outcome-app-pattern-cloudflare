# Security — authentication

Identity for this pattern is **Cloudflare Access**: it hosts the login UI, brokers the identity
provider (Google / GitHub / email OTP — all free on Zero Trust, ≤50 users), and mints signed JWTs
for both humans (login) and machines (service tokens). Every Worker validates that JWT with **one
shared module** — `shared/access-jwt` (`verifyAccessJwt`) — against Access's public JWKS.

Auth is **config-gated like rate limiting and Turnstile**: with `ACCESS_AUD` unset the verifier
returns `disabled` and every surface stays open, so the hermetic suite (`task ci`) and local
`wrangler dev` need no tokens. Setting the two vars per Worker turns enforcement on in production.

## Prerequisite — a custom domain (already owned: `domainapps.org`)

Access applications attach **per hostname in a zone you control**; `*.workers.dev` can't host one.
Add `domainapps.org` as a Cloudflare zone (free) and put each Worker on a subdomain, then create one
Access application per hostname. Zone, Access (≤50 users), and Worker custom domains are all free —
the only cost is owning the domain, which you already do.

| Worker | Hostname | Access application |
| --- | --- | --- |
| `colour-behaviour-service` | `colour-api.domainapps.org` | Self-hosted (+ a service token for direct/mobile callers) |
| `colour-web` | `colour-web.domainapps.org` | Self-hosted (end-user login) |
| `colour-agent` | `colour-agent.domainapps.org` | Self-hosted, OIDC — the OAuth provider MCP clients authenticate against |
| `colour-data-products` | `colour-data.domainapps.org` | Self-hosted (gates the read surface) |

## The one seam — `shared/access-jwt`

`verifyAccessJwt(request, { teamDomain, aud }, key?)` returns `disabled` (auth off), `ok` (with the
caller's `{ email, sub }`), or `unauthorized` (with a `missing`/`invalid` reason). It reads the token
from the edge-injected `Cf-Access-Jwt-Assertion` header or an `Authorization: Bearer` token, and
verifies signature, `iss` (the team domain), `aud` (the app tag) and expiry. `key` is injectable so
the unit tests verify against a locally-signed key with no network. Issuer-agnostic by construction:
swapping Access for another OIDC provider (e.g. Supabase) later changes only `teamDomain`/`aud` and
the JWKS URL — every enforcement point below stays put.

## Where it's enforced

- **Domain API (`domain/api`).** `requireAuth` guards `POST /colours` (before the rate limiter, so an
  unauthorised caller spends no budget). Trust model mirrors the rate limiter's: a **direct external**
  caller sets an unspoofable `cf-connecting-ip` and must present an Access token (a user JWT, or a
  service token Access exchanges for one); the **first-party** web/agent channels reach the domain
  over a service binding — no client IP, not publicly invocable — so they're trusted transport, and
  the web channel additionally forwards the user's JWT so the domain still learns who is calling. A
  present-but-invalid token is always rejected (`401`). Reads and the SSE feed stay open (an
  `EventSource` can't send an auth header), matching the domain's public-read stance. The contract
  documents this: `securitySchemes` (`accessJwt`, `bearerAuth`) + a `401` on the write.
- **Web (`experiences/web`).** Behind an Access self-hosted app: Access renders the login page and
  injects the JWT (no login UI to build). The worker validates it on `/api/*` (defence in depth) and
  forwards `Cf-Access-Jwt-Assertion` to the domain over the service binding.
- **Mobile (`experiences/mobile`).** A native app can't ride the browser cookie, so `src/auth.ts`
  runs the Access **OIDC** flow (`expo-auth-session`, OAuth + PKCE, system browser) and attaches the
  token as a bearer via an `openapi-fetch` middleware. Gated on `EXPO_PUBLIC_ACCESS_*` — inert in the
  open demo. For machine-only access with no per-user identity, an Access **service token**
  (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) is the alternative.
- **Agent (`experiences/agent`).** `/mcp` and `/sse` are gated at the fetch boundary: with the
  hostname behind Access acting as the **OAuth provider**, MCP clients (Claude, MCP Inspector, the AI
  Playground) complete the browser auth flow and present the resulting JWT, which the worker
  validates before serving.
- **Data products (`platform/data-products`).** A Hono middleware guards `/products/*` and
  `/run/summarise`; the visualisation page itself is gated at the edge by Access.

## One-time Zero Trust setup

1. Add `domainapps.org` as a zone; point each Worker at its subdomain (Workers → *worker* → Custom
   Domains, or a route).
2. Zero Trust → Access → Applications: create one application per hostname above, pick an identity
   provider, and set an access policy (the allow-list — this is why it's *gated* access, not open
   consumer signup). Each app has an **Audience (AUD) tag**.
3. For the domain's direct/mobile callers, create a **service token** (Access → Service Auth) and add
   a policy that accepts it.
4. Set the vars per Worker (neither is secret): `ACCESS_TEAM_DOMAIN`
   (`https://<team>.cloudflareaccess.com`) and `ACCESS_AUD` (that app's tag). For mobile, set
   `EXPO_PUBLIC_ACCESS_TEAM_DOMAIN` and `EXPO_PUBLIC_ACCESS_CLIENT_ID`.

Validation needs only public material (JWKS + team domain + AUD tag), so **no secret lands in Worker
code**.

## Scope, honestly

- Access is **gated access** (allow-listed / invited identities via a policy), not self-serve
  consumer signup. Right for a reference; if the real product later needs public signups, swap the
  `verifyAccessJwt` seam to a consumer IdP — enforcement points, the forwarded-JWT flow, and the
  contract are unchanged.
- The custom-domain prerequisite is a setup step, not a recurring cost.
- This layer is **authentication + coarse allow-list authorization**. There's still no per-user data
  or role model in the domain (every colour is shared) — identity is captured (`email`/`sub`) and
  available for logging, but not yet used for row-level authorization.
- Enforcement is off until provisioned, exactly like Turnstile — so committing this changes nothing
  about the running demo until you set the vars.
