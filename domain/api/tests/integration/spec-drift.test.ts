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

  it("honours the contract's limit bounds and default", async () => {
    const params = (openapiDoc.paths["/colours"].get as { parameters: LimitParam[] }).parameters;
    const limit = params.find((p) => p.name === "limit");
    expect(limit).toBeDefined();
    const { minimum, maximum, default: dflt } = limit!.schema;

    expect((await SELF.fetch(`http://api/colours?limit=${minimum - 1}`)).status).toBe(422);
    expect((await SELF.fetch(`http://api/colours?limit=${maximum + 1}`)).status).toBe(422);
    expect((await SELF.fetch("http://api/colours?limit=nonsense")).status).toBe(422);
    expect((await SELF.fetch(`http://api/colours?limit=${minimum}`)).status).toBe(200);
    expect((await SELF.fetch(`http://api/colours?limit=${maximum}`)).status).toBe(200);

    for (let i = 0; i < dflt + 2; i++) {
      await SELF.fetch("http://api/colours", { method: "POST" });
    }
    const body = (await (await SELF.fetch("http://api/colours")).json()) as unknown[];
    expect(body).toHaveLength(dflt);
  });

  it("returns colours from the contract's enum", async () => {
    const colourEvent = openapiDoc.components.schemas.ColourEvent as {
      properties: { colour: { enum: string[] } };
    };
    const enumValues = colourEvent.properties.colour.enum;
    const body = (await (
      await SELF.fetch("http://api/colours", { method: "POST" })
    ).json()) as { colour: string };
    expect(enumValues).toContain(body.colour);
  });
});
