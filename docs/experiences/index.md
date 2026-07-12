# Experiences

Three channels, zero shared code, all consuming the one todo API: **web**, **mobile**, and
**agent**. Each demonstrates a different consumption style over the identical endpoints
(`POST /todos`, `GET /todos`, `GET|PATCH|DELETE /todos/{id}`, and the per-user SSE feed at
`GET /events/stream`) — always as the authenticated caller, so each channel sees only that
user's todos.

Each channel also demonstrates a different **authentication** style once Cloudflare Access is
provisioned — the web channel's edge login, the mobile app's OIDC flow, and the agent's OAuth for
MCP clients. While Access is unprovisioned every request acts as the fixed dev identity, so the
demo works tokenless. See [security](../security/index.md).

Each channel **self-identifies** on every mutation via the `X-Channel` header (the web proxy
and agent set it server-side; the mobile client sets it in its fetch middleware), so every
emitted event — and both data products — record where the todo activity came from. Direct
callers record as `api`; `X-Test: true` marks traffic as test. See
[data products](../data-products/index.md).

## Web (`experiences/web`)

The `todo-web` Worker serves static assets and **proxies same-origin** through its own Worker
to the domain API: any `/api/*` method+path+query+body passes through the service binding, and
the edge-injected Access JWT is forwarded on **every** call — including the SSE stream, which
is per-user and useless without an identity. The page is a todo list: add, toggle, delete, and
live `{type, data}` SSE frames applied as idempotent upserts (another tab or the mobile app
mutating the same account stays in sync). Local: http://localhost:8789 (`task up`). Deployed:
`https://todo-web.<subdomain>.workers.dev`.

## Mobile (`experiences/mobile`)

An Expo / React Native app. HTTP calls go through a **typed client** (`openapi-fetch` over
`src/api/schema.ts`, generated from the committed OpenAPI contract with `task gen:types`) — the
app cannot call an endpoint or read a field the contract doesn't define. The live feed uses a
small **fetch-streaming SSE reader** (`src/sse.ts`) rather than `EventSource`, because the
per-user stream is authenticated and `EventSource` can't send an `Authorization: Bearer`
header. Unlike web, mobile talks to the domain API **directly** — the CORS-enabled channel,
demonstrating cross-origin access to the same todo surface.

The API base URL comes from `EXPO_PUBLIC_API_URL` (default `http://localhost:8787`, the domain
Worker's local port). Run `task up` first, then:

```bash
cd experiences/mobile
npm install
npx expo start      # open in Expo Go / a simulator, or press w for web
```

For a native device, set `EXPO_PUBLIC_API_URL` to a host reachable from the device (your LAN IP,
or the deployed `*.workers.dev` API URL). Point it at
`https://todo-behaviour-service.<subdomain>.workers.dev` and the same code runs against
production.

## Agent (`experiences/agent`)

The `todo-agent` Worker exposes the one todo API as **MCP tools**, so an LLM client drives the
same todo domain — as the calling user: the worker captures the caller's Access token at the
transport boundary and forwards it on every domain call. The domain API is reached over a
**service binding** (`DOMAIN_API`); MCP sessions persist in a SQLite-backed Durable Object (the
free-plan requirement).

Four tools, over the identical endpoints:

| Tool | Endpoint | Notes |
|---|---|---|
| `add_todo` | `POST /todos` | create a todo (`title` 1–256 chars) |
| `list_todos` | `GET /todos?completed=&limit=` | most recent first; optional completion filter |
| `complete_todo` | `PATCH /todos/{id}` | sets `completed` (404 → `{ detail: "not found" }`) |
| `delete_todo` | `DELETE /todos/{id}` | 204 → `{ deleted: true, id }` |

Two transports:

- `POST /mcp` — streamable-http (current MCP clients)
- `GET|POST /sse` — legacy SSE transport

### Interacting with the deployed agent

A **remote MCP server** (open until Access is provisioned; then Access is the OAuth provider):

- Streamable-HTTP: `https://todo-agent.<subdomain>.workers.dev/mcp`
- SSE: `https://todo-agent.<subdomain>.workers.dev/sse`

Ways to connect:

1. **Cloudflare AI Playground** ([playground.ai.cloudflare.com](https://playground.ai.cloudflare.com)) —
   add an MCP server, paste the `/mcp` URL. Zero install.
2. **MCP Inspector** — `npx @modelcontextprotocol/inspector`, transport *Streamable HTTP*, the
   `/mcp` URL.
3. **Claude Code** — `claude mcp add --transport http todo https://todo-agent.<subdomain>.workers.dev/mcp`.
4. **Claude Desktop / Cursor** — for stdio-only clients, bridge with
   `npx mcp-remote https://todo-agent.<subdomain>.workers.dev/mcp`.
5. **Raw HTTP** — JSON-RPC over `/mcp`: `initialize` → `notifications/initialized` →
   `tools/list` → `tools/call`, carrying the `mcp-session-id` header from `initialize`.

> **Gotcha:** Cloudflare's edge blocks the default `Python-urllib` User-Agent (bot protection) —
> a raw `urllib` request gets HTTP 403 while `curl` and real MCP clients (normal User-Agent)
> succeed. Set a normal `User-Agent` header if scripting in Python.

Locally, `task up` runs the agent on `wrangler dev` port 8790 — point a client at
`http://localhost:8790/mcp`.
