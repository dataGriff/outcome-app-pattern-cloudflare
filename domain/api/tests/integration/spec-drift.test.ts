/** Spec drift: the implementation must not drift from the committed contract.
 *
 * The served /openapi.json IS the committed spec here (unlike FastAPI, which
 * generates its own), so the teeth are (a) the route registry compared against
 * the contract's path×method surface both ways, and (b) behavioural probes
 * driven by values parsed from the spec — normalized subset, never byte
 * equality, same approach as the source repo's test_spec_drift.py.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app, openapiDoc } from "../../src/routes";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
// Served for tooling/docs, deliberately outside the contract surface.
const INFRA_ROUTES = new Set(["/openapi.json", "/docs"]);

interface LimitParam {
  name: string;
  schema: { minimum: number; maximum: number; default: number };
}

function contractOperations(): Set<string> {
  const ops = new Set<string>();
  for (const [path, item] of Object.entries(openapiDoc.paths)) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.includes(method)) ops.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return ops;
}

async function create(title: string): Promise<Response> {
  return SELF.fetch("http://api/todos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

describe("spec drift", () => {
  it("route registry equals the contract's path×method surface", () => {
    const served = new Set(
      app.routes
        .filter((r) => r.method !== "ALL" && !INFRA_ROUTES.has(r.path))
        .map((r) => `${r.method} ${r.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`),
    );
    expect(served).toEqual(contractOperations());
  });

  it("serves the committed contract at /openapi.json", async () => {
    const resp = await SELF.fetch("http://api/openapi.json");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(openapiDoc);
  });

  it("honours the contract's limit bounds", async () => {
    const params = (openapiDoc.paths["/todos"].get as { parameters: LimitParam[] }).parameters;
    const limit = params.find((p) => p.name === "limit");
    expect(limit).toBeDefined();
    const { minimum, maximum } = limit!.schema;

    expect((await SELF.fetch(`http://api/todos?limit=${minimum - 1}`)).status).toBe(422);
    expect((await SELF.fetch(`http://api/todos?limit=${maximum + 1}`)).status).toBe(422);
    expect((await SELF.fetch("http://api/todos?limit=nonsense")).status).toBe(422);
    expect((await SELF.fetch(`http://api/todos?limit=${minimum}`)).status).toBe(200);
    expect((await SELF.fetch(`http://api/todos?limit=${maximum}`)).status).toBe(200);
  });

  it("honours the contract's title length bounds", async () => {
    const newTodo = openapiDoc.components.schemas.NewTodo as {
      properties: { title: { minLength: number; maxLength: number } };
    };
    const { minLength, maxLength } = newTodo.properties.title;

    expect((await create("x".repeat(maxLength + 1))).status).toBe(422);
    expect((await create("x".repeat(minLength - 1))).status).toBe(422);
    expect((await create("x".repeat(maxLength))).status).toBe(201);
    expect((await create("x".repeat(minLength))).status).toBe(201);
  });

  it("405s an unspec'd method on a templated path (contract-driven, not 404)", async () => {
    const resp = await SELF.fetch(`http://api/todos/${crypto.randomUUID()}`, { method: "PUT" });
    expect(resp.status).toBe(405);
    expect(resp.headers.get("allow")).toContain("PATCH");
  });
});
