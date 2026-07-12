# Experiences

Three channels, zero shared code, all consuming the one behaviour API: **web**, **mobile**, and
**agent**. Each demonstrates a different consumption style over the identical endpoints
(`POST /colours`, `GET /colours/latest`, `GET /colours?limit=N`, and the SSE feed at
`GET /events/stream`).

Each channel also demonstrates a different **authentication** style once Cloudflare Access is
provisioned — the web channel's edge login, the mobile app's OIDC flow, and the agent's OAuth for
MCP clients — all inert in the open demo. See [security](../security/index.md).

## Web (`experiences/web`)

The `colour-web` Worker serves static assets and **proxies same-origin** through its own Worker
to the domain API. Local: http://localhost:8789 (`task up`). Deployed:
`https://colour-web.<subdomain>.workers.dev`.

## Mobile (`experiences/mobile`)

An Expo / React Native app. HTTP calls go through a **typed client** (`openapi-fetch` over
`src/api/schema.ts`, generated from the committed OpenAPI contract with `task gen:types`) — the
app cannot call an endpoint or read a field the contract doesn't define. SSE stays a raw
`EventSource`. Unlike web, mobile talks to the domain API **directly** — the CORS-enabled
channel, demonstrating cross-origin access to the same behaviour surface.

The API base URL comes from `EXPO_PUBLIC_API_URL` (default `http://localhost:8787`, the domain
Worker's local port). Run `task up` first, then:

```bash
cd experiences/mobile
npm install
npx expo start      # open in Expo Go / a simulator, or press w for web
```

For a native device, set `EXPO_PUBLIC_API_URL` to a host reachable from the device (your LAN IP,
or the deployed `*.workers.dev` API URL). Point it at
`https://colour-behaviour-service.<subdomain>.workers.dev` and the same code runs against
production.

## Agent (`experiences/agent`)

The `colour-agent` Worker exposes the one behaviour API as **MCP tools**, so an LLM client drives
the same colour domain. A faithful port of the source repo's FastMCP server onto Cloudflare's
`agents` `McpAgent`. The domain API is reached over a **service binding** (`DOMAIN_API`); MCP
sessions persist in a SQLite-backed Durable Object (the free-plan requirement).

Three tools, over the identical endpoints:

| Tool | Endpoint | Notes |
|---|---|---|
| `generate_colour` | `POST /colours` | generate a new colour event |
| `latest_colour` | `GET /colours/latest` | 404 → `{ detail: "no colours generated yet" }` |
| `colour_history` | `GET /colours?limit=N` | most recent first, `limit` 1–100 (default 10) |

Two transports:

- `POST /mcp` — streamable-http (current MCP clients)
- `GET|POST /sse` — legacy SSE transport

### Interacting with the deployed agent

It's an open (no-auth) **remote MCP server**:

- Streamable-HTTP: `https://colour-agent.<subdomain>.workers.dev/mcp`
- SSE: `https://colour-agent.<subdomain>.workers.dev/sse`

Ways to connect:

1. **Cloudflare AI Playground** ([playground.ai.cloudflare.com](https://playground.ai.cloudflare.com)) —
   add an MCP server, paste the `/mcp` URL. Zero install.
2. **MCP Inspector** — `npx @modelcontextprotocol/inspector`, transport *Streamable HTTP*, the
   `/mcp` URL.
3. **Claude Code** — `claude mcp add --transport http colour https://colour-agent.<subdomain>.workers.dev/mcp`.
4. **Claude Desktop / Cursor** — for stdio-only clients, bridge with
   `npx mcp-remote https://colour-agent.<subdomain>.workers.dev/mcp`.
5. **Raw HTTP** — JSON-RPC over `/mcp`: `initialize` → `notifications/initialized` →
   `tools/list` → `tools/call`, carrying the `mcp-session-id` header from `initialize`.

> **Gotcha:** Cloudflare's edge blocks the default `Python-urllib` User-Agent (bot protection) —
> a raw `urllib` request gets HTTP 403 while `curl` and real MCP clients (normal User-Agent)
> succeed. Set a normal `User-Agent` header if scripting in Python.

Locally, `task up` runs the agent on `wrangler dev` port 8790 — point a client at
`http://localhost:8790/mcp`.
