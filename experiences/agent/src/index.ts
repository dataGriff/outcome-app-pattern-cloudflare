import { verifyAccessJwt } from "@todo/access-jwt";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// MCP SDK 1.29's tool() types are built against zod v3; `agents` pulls zod v4,
// and the two can't be deduped. Use the v3-compatible surface (shipped by the
// v4 package) at runtime so schema validation works.
import { z } from "zod/v3";
import type { Env } from "./env";

const DOMAIN = "https://behaviour-service";

const ACCESS_HEADER = "cf-access-jwt-assertion";

/** Per-session props, captured at the transport boundary and forwarded on
 * every domain call: the caller's Access JWT (so the todos the tools touch are
 * the caller's own) and their X-Test declaration (so test traffic through the
 * agent stays marked in the data products). */
interface Props extends Record<string, unknown> {
  accessToken?: string;
  isTest?: boolean;
}

function extractToken(request: Request): string | undefined {
  const assertion = request.headers.get(ACCESS_HEADER);
  if (assertion) return assertion;
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return undefined;
}

type ToolContent = { content: { type: "text"; text: string }[]; isError?: boolean };
/** A concrete, non-generic view of McpServer.tool for the parametered tools.
 * The SDK's generic ShapeOutput inference recurses infinitely across the split
 * zod versions (TS2589); pinning the signature here stops instantiation without
 * changing runtime behaviour — the zod schemas still validate the arguments. */
type ParametricTool<Args> = (
  name: string,
  description: string,
  schema: Record<string, unknown>,
  cb: (args: Args) => Promise<ToolContent>,
) => void;

/** The agent channel: the one todo API exposed as MCP tools, so an LLM client
 * drives the same domain the web and mobile channels do — as the same user.
 * Four tools over the identical endpoints, forwarding the caller's Access JWT
 * on every call. */
export class TodoAgent extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: "todo-domain", version: "1.0.0" });

  async init() {
    const api = this.env.DOMAIN_API;
    // Read the token per call, not at init: the session outlives the
    // initializing request and later calls may carry a refreshed JWT.
    const headers = (): Record<string, string> => {
      const token = this.props?.accessToken;
      return {
        "content-type": "application/json",
        "x-channel": "agent",
        ...(token ? { [ACCESS_HEADER]: token } : {}),
        ...(this.props?.isTest ? { "x-test": "true" } : {}),
      };
    };

    const rateLimited = (r: Response): ToolContent | null => {
      if (r.status !== 429) return null;
      const retry = r.headers.get("Retry-After") ?? "60";
      return {
        content: [{ type: "text", text: `Rate limited: too many todo writes. Retry after ${retry} seconds.` }],
        isError: true,
      };
    };

    (this.server.tool as unknown as ParametricTool<{ title: string }>)(
      "add_todo",
      "Add a todo for the calling user (POST /todos).",
      { title: z.string().min(1).max(256) },
      async ({ title }) => {
        const r = await api.fetch(`${DOMAIN}/todos`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ title }),
        });
        return rateLimited(r) ?? { content: [{ type: "text", text: await r.text() }] };
      },
    );

    (this.server.tool as unknown as ParametricTool<{ completed?: boolean; limit?: number }>)(
      "list_todos",
      "List the calling user's todos, most recent first (GET /todos). Optionally filter by completion state and cap the count.",
      { completed: z.boolean().optional(), limit: z.number().optional() },
      async ({ completed, limit }) => {
        const params = new URLSearchParams();
        if (completed !== undefined) params.set("completed", String(completed));
        if (limit !== undefined) params.set("limit", String(limit));
        const qs = params.size > 0 ? `?${params}` : "";
        const r = await api.fetch(`${DOMAIN}/todos${qs}`, { headers: headers() });
        return { content: [{ type: "text", text: await r.text() }] };
      },
    );

    (this.server.tool as unknown as ParametricTool<{ id: string }>)(
      "complete_todo",
      "Mark one of the calling user's todos as completed (PATCH /todos/{id}).",
      { id: z.string() },
      async ({ id }) => {
        const r = await api.fetch(`${DOMAIN}/todos/${id}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ completed: true }),
        });
        return rateLimited(r) ?? { content: [{ type: "text", text: await r.text() }] };
      },
    );

    (this.server.tool as unknown as ParametricTool<{ id: string }>)(
      "delete_todo",
      "Delete one of the calling user's todos (DELETE /todos/{id}).",
      { id: z.string() },
      async ({ id }) => {
        const r = await api.fetch(`${DOMAIN}/todos/${id}`, {
          method: "DELETE",
          headers: headers(),
        });
        const limited = rateLimited(r);
        if (limited) return limited;
        if (r.status === 204) {
          return { content: [{ type: "text", text: JSON.stringify({ deleted: true, id }) }] };
        }
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
      // Hand the raw token and the test declaration to the agent session
      // (McpAgent surfaces ctx.props as this.props) so every tool call acts as
      // the caller, not the worker.
      (ctx as ExecutionContext & { props: Props }).props = {
        accessToken: extractToken(request),
        isTest: request.headers.get("x-test") === "true",
      };
    }

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return TodoAgent.serveSSE("/sse").fetch(request, env, ctx);
    }
    if (url.pathname === "/mcp") {
      return TodoAgent.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("todo-agent — MCP on /mcp (streamable-http) and /sse", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
