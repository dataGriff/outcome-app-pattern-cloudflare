# experiences/agent — MCP agent experience

The **agent** channel: the one behaviour API exposed as MCP tools, so an LLM
client drives the same colour domain the web and mobile channels do. A faithful
port of the source repo's FastMCP server onto Cloudflare's `agents` `McpAgent`.

Three tools, over the identical endpoints:

| Tool | Endpoint | Notes |
|---|---|---|
| `generate_colour` | `POST /colours` | generate a new colour event |
| `latest_colour` | `GET /colours/latest` | 404 → `{ detail: "no colours generated yet" }` |
| `colour_history` | `GET /colours?limit=N` | most recent first, `limit` 1–100 (default 10) |

The domain API is reached over a **service binding** (`DOMAIN_API`); MCP sessions
persist in a SQLite-backed Durable Object (the free-plan requirement).

## Endpoints

- `POST /mcp` — streamable-http transport (current MCP clients)
- `GET|POST /sse` — legacy SSE transport

## Running locally

`task up` brings the whole stack up (the agent on `wrangler dev` port 8790).
Point an MCP client (e.g. the MCP Inspector) at `http://localhost:8790/mcp`.
