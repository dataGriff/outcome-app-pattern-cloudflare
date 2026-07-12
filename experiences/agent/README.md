# experiences/agent — MCP agent experience

The **agent** channel: the one todo API exposed as MCP tools (`add_todo`,
`list_todos`, `complete_todo`, `delete_todo`) over streamable-http (`/mcp`) and legacy
SSE (`/sse`), backed by a SQLite Durable Object for session persistence. The caller's
Access JWT is forwarded on every domain call, so the tools act on the caller's own todos.

Canonical documentation — the tools, endpoints, local dev, and how to interact with the
**deployed** MCP agent — lives in
[`docs/experiences/index.md`](../../docs/experiences/index.md#agent-experiencesagent).
