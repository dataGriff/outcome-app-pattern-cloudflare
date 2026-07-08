export interface Env {
  // The behaviour API, reached over a service binding — the agent calls the
  // same POST /colours, GET /colours/latest and GET /colours endpoints as the
  // web and mobile channels.
  DOMAIN_API: Fetcher;
  // McpAgent persists session state in this SQLite-backed Durable Object.
  MCP_OBJECT: DurableObjectNamespace;
}
