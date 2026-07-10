import { Hono } from "hono";
import { cors } from "hono/cors";
import { parse } from "yaml";
import specText from "../../contracts/api/behaviour-service.openapi.yaml";
import type { components } from "../types/api";
import { createColour, latest, recent } from "./db";
import type { Env } from "./env";
import { rateLimit } from "./ratelimit";

type ColourEvent = components["schemas"]["ColourEvent"];
type Colour = ColourEvent["colour"];

// `satisfies` ties this runtime list to the contract's enum — changing the
// enum in the committed spec breaks the build here after gen:types.
const COLOURS = ["red", "amber", "green"] as const satisfies readonly Colour[];

/** The committed OpenAPI contract, served verbatim at /openapi.json. */
export const openapiDoc = parse(specText) as {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
};

const DOCS_HTML = `<!doctype html>
<html>
  <head><title>Colour Behaviour Service — API docs</title><meta charset="utf-8"></head>
  <body>
    <div id="swagger-ui"></div>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });</script>
  </body>
</html>`;

export const app = new Hono<{ Bindings: Env }>();

// Experiences (mobile web export, agents) call the API cross-origin. Expose
// Retry-After so a cross-origin caller can read how long to back off on a 429.
app.use("*", cors({ exposeHeaders: ["Retry-After"] }));

app.post("/colours", rateLimit, async (c) => {
  const colour = COLOURS[Math.floor(Math.random() * COLOURS.length)];
  const row = await createColour(c.env, colour);
  // Poke the relay for immediate drain; its alarm is the at-least-once backstop.
  c.executionCtx.waitUntil(
    c.env.OUTBOX_RELAY.get(c.env.OUTBOX_RELAY.idFromName("relay")).poke(),
  );
  const body: ColourEvent = { colour: row.colour, timestamp: row.created_at };
  return c.json(body);
});

app.get("/colours/latest", async (c) => {
  const row = await latest(c.env);
  if (row === null) return c.json({ detail: "no colours generated yet" }, 404);
  const body: ColourEvent = { colour: row.colour, timestamp: row.created_at };
  return c.json(body);
});

app.get("/colours", async (c) => {
  const raw = c.req.query("limit");
  let limit = 10;
  if (raw !== undefined) {
    limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      // 422 to match the contract (and the FastAPI original), not a generic 400.
      return c.json({ detail: "limit must be an integer between 1 and 100" }, 422);
    }
  }
  const rows = await recent(c.env, limit);
  const body: ColourEvent[] = rows.map((r) => ({ colour: r.colour, timestamp: r.created_at }));
  return c.json(body);
});

app.get("/events/stream", (c) => {
  const stub = c.env.STREAM.get(c.env.STREAM.idFromName("stream"));
  return stub.fetch(c.req.raw);
});

app.get("/openapi.json", (c) => c.json(openapiDoc));
app.get("/docs", (c) => c.html(DOCS_HTML));

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

// Contract-driven 405: a request to a path the spec knows, with a method it
// doesn't, is method-not-allowed rather than not-found.
app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  const item = openapiDoc.paths[path];
  if (item !== undefined) {
    const allowed = Object.keys(item)
      .filter((m) => HTTP_METHODS.includes(m))
      .map((m) => m.toUpperCase());
    if (!allowed.includes(c.req.method)) {
      return c.json({ detail: "method not allowed" }, 405, { Allow: allowed.join(", ") });
    }
  }
  return c.json({ detail: "not found" }, 404);
});
