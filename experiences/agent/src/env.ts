export interface Env {
  // The todo API, reached over a service binding — the agent calls the same
  // /todos CRUD endpoints as the web and mobile channels, forwarding the
  // caller's Access JWT so the todos it touches are the caller's own.
  DOMAIN_API: Fetcher;
  // McpAgent persists session state in this SQLite-backed Durable Object.
  MCP_OBJECT: DurableObjectNamespace;
  // Cloudflare Access identity. When /mcp is behind Access (OAuth for MCP
  // clients), set both to validate the caller's token at this boundary. Unset =
  // inert (the demo runs open). See docs/security.
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
