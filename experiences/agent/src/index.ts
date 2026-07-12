import { verifyAccessJwt } from "@colour/access-jwt";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// MCP SDK 1.29's tool() types are built against zod v3; `agents` pulls zod v4,
// and the two can't be deduped. Use the v3-compatible surface (shipped by the
// v4 package) at runtime so schema validation works.
import { z } from "zod/v3";
import type { Env } from "./env";

const DOMAIN = "https://behaviour-service";

type ToolContent = { content: { type: "text"; text: string }[] };
/** A concrete, non-generic view of McpServer.tool for the one parametered tool.
 * The SDK's generic ShapeOutput inference recurses infinitely across the split
 * zod versions (TS2589); pinning the signature here stops instantiation without
 * changing runtime behaviour — the zod schema still validates the arguments. */
type ParametricTool = (
  name: string,
  description: string,
  schema: Record<string, unknown>,
  cb: (args: { limit?: number }) => Promise<ToolContent>,
) => void;

/** The agent channel: the one behaviour API exposed as MCP tools, so an LLM
 * client drives the same domain the web and mobile channels do. A faithful port
 * of the source repo's FastMCP server — three tools over the identical
 * endpoints, including the 404 → detail mapping on latest_colour. */
export class ColourAgent extends McpAgent<Env> {
  server = new McpServer({ name: "colour-domain", version: "1.0.0" });

  async init() {
    const api = this.env.DOMAIN_API;

    this.server.tool(
      "generate_colour",
      "Generate a new colour event via the behaviour domain (POST /colours).",
      {},
      async () => {
        const r = await api.fetch(`${DOMAIN}/colours`, { method: "POST" });
        if (r.status === 429) {
          const retry = r.headers.get("Retry-After") ?? "60";
          return {
            content: [
              {
                type: "text",
                text: `Rate limited: too many colour generations. Retry after ${retry} seconds.`,
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: await r.text() }] };
      },
    );

    this.server.tool(
      "latest_colour",
      "Return the most recently generated colour (GET /colours/latest).",
      {},
      async () => {
        const r = await api.fetch(`${DOMAIN}/colours/latest`);
        if (r.status === 404) {
          return {
            content: [{ type: "text", text: JSON.stringify({ detail: "no colours generated yet" }) }],
          };
        }
        return { content: [{ type: "text", text: await r.text() }] };
      },
    );

    (this.server.tool as unknown as ParametricTool)(
      "colour_history",
      "Return recent colour history, most recent first (GET /colours?limit=N).",
      { limit: z.number().optional() },
      async ({ limit }) => {
        const r = await api.fetch(`${DOMAIN}/colours?limit=${limit ?? 10}`);
        return { content: [{ type: "text", text: await r.text() }] };
      },
    );
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const isTransport =
      url.pathname === "/sse" || url.pathname === "/sse/message" || url.pathname === "/mcp";

    // Gate the MCP transports behind Access. When /mcp is fronted by Access
    // acting as the OAuth provider, MCP clients (Claude, Inspector, the AI
    // Playground) complete the browser auth flow and present the resulting JWT;
    // we validate it here. Inert until ACCESS_AUD is set. See docs/security.
    if (isTransport) {
      const auth = await verifyAccessJwt(request, {
        teamDomain: env.ACCESS_TEAM_DOMAIN,
        aud: env.ACCESS_AUD,
      });
      if (auth.status === "unauthorized") {
        return new Response("unauthorized", { status: 401 });
      }
    }

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return ColourAgent.serveSSE("/sse").fetch(request, env, ctx);
    }
    if (url.pathname === "/mcp") {
      return ColourAgent.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("colour-agent — MCP on /mcp (streamable-http) and /sse", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
