/** Drives the agent worker over the real MCP streamable-http transport: a full
 * initialize handshake, then tools/list and tools/call for each of the four
 * tools. The DOMAIN_API service binding is mocked (see vitest.config.ts) with a
 * user-aware store that 401s unless the agent forwarded the caller's Access
 * JWT — so this proves the McpAgent wiring, tool registration, the API mapping
 * AND the identity forwarding end to end. */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const MCP = "https://agent/mcp";
// The token the transport requests carry; Access is unprovisioned in tests so
// it isn't validated — but the agent must still forward it to the domain (the
// mock rejects calls without it).
const TOKEN = "test-user-jwt";
const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "cf-access-jwt-assertion": TOKEN,
};

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

describe("todo agent MCP tools", () => {
  it("lists four tools and drives the todo API through each as the caller", async () => {
    const sid = await initSession();

    const tools = await call(sid, 2, "tools/list", {});
    const names = tools.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["add_todo", "complete_todo", "delete_todo", "list_todos"]);

    // The mock 401s without the forwarded JWT, so a successful add proves the
    // agent passed the caller's token through the service binding.
    const added = toolText(await call(sid, 3, "tools/call", { name: "add_todo", arguments: { title: "buy milk" } }));
    expect(added.title).toBe("buy milk");
    expect(added.completed).toBe(false);

    const listed = toolText(await call(sid, 4, "tools/call", { name: "list_todos", arguments: {} }));
    expect(listed.map((t: { id: string }) => t.id)).toContain(added.id);

    const completed = toolText(
      await call(sid, 5, "tools/call", { name: "complete_todo", arguments: { id: added.id } }),
    );
    expect(completed.completed).toBe(true);
    expect(completed.completed_at).toBeTruthy();

    const remaining = toolText(
      await call(sid, 6, "tools/call", { name: "list_todos", arguments: { completed: false } }),
    );
    expect(remaining.map((t: { id: string }) => t.id)).not.toContain(added.id);

    const deleted = toolText(
      await call(sid, 7, "tools/call", { name: "delete_todo", arguments: { id: added.id } }),
    );
    expect(deleted).toEqual({ deleted: true, id: added.id });

    const missing = toolText(
      await call(sid, 8, "tools/call", { name: "complete_todo", arguments: { id: added.id } }),
    );
    expect(missing).toEqual({ detail: "not found" });
  });
});
