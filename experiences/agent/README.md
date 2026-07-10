# experiences/agent — MCP agent experience

The **agent** channel: the one behaviour API exposed as MCP tools (`generate_colour`,
`latest_colour`, `colour_history`) over streamable-http (`/mcp`) and legacy SSE (`/sse`),
backed by a SQLite Durable Object for session persistence.

Canonical documentation — the tools, endpoints, local dev, and how to interact with the
**deployed** MCP agent — lives in
[`docs/experiences/index.md`](../../docs/experiences/index.md#agent-experiencesagent).
