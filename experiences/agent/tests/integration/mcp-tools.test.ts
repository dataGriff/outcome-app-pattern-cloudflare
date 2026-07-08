/** Drives the agent worker over the real MCP streamable-http transport: a full
 * initialize handshake, then tools/list and tools/call for each of the three
 * tools. The DOMAIN_API service binding is mocked (see vitest.config.ts), so
 * this proves the McpAgent wiring, tool registration and the API mapping —
 * including latest_colour's 404 → detail — end to end. */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const MCP = "https://agent/mcp";
const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

/** Parse a JSON-RPC reply whether it comes back as plain JSON or SSE frames. */
async function rpcResult(resp: Response): Promise<any> {
  const text = await resp.text();
  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return line ? JSON.parse(line.slice(5).trim()) : null;
  }
  return JSON.parse(text);
}

async function initSession(): Promise<string> {
  const resp = await SELF.fetch(MCP, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    }),
  });
  const sid = resp.headers.get("mcp-session-id");
  expect(sid).toBeTruthy();
  await SELF.fetch(MCP, {
    method: "POST",
    headers: { ...HEADERS, "mcp-session-id": sid! },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  return sid!;
}

async function call(sid: string, id: number, method: string, params: unknown): Promise<any> {
  const resp = await SELF.fetch(MCP, {
    method: "POST",
    headers: { ...HEADERS, "mcp-session-id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return rpcResult(resp);
}

const toolText = (result: any) => JSON.parse(result.result.content[0].text);

describe("colour agent MCP tools", () => {
  it("lists three tools and drives the behaviour API through each", async () => {
    const sid = await initSession();

    const tools = await call(sid, 2, "tools/list", {});
    const names = tools.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["colour_history", "generate_colour", "latest_colour"]);

    // Before any generate, latest maps the domain's 404 to a detail object.
    const empty = toolText(await call(sid, 3, "tools/call", { name: "latest_colour", arguments: {} }));
    expect(empty).toEqual({ detail: "no colours generated yet" });

    const gen = toolText(await call(sid, 4, "tools/call", { name: "generate_colour", arguments: {} }));
    expect(["red", "amber", "green"]).toContain(gen.colour);

    const latest = toolText(await call(sid, 5, "tools/call", { name: "latest_colour", arguments: {} }));
    expect(latest.colour).toBe(gen.colour);

    const history = toolText(await call(sid, 6, "tools/call", { name: "colour_history", arguments: { limit: 5 } }));
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].colour).toBe(gen.colour);
  });
});
