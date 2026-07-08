/** The published event payload must match the AsyncAPI contract.
 *
 * The outbox row's payload IS the message the relay publishes byte-for-byte,
 * so validating it against the contract schema preserves the source repo's
 * NATS-subscription guarantee without a subscribable broker.
 */
import { Validator } from "@cfworker/json-schema";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("event contract", () => {
  it("outbox payload validates against the AsyncAPI ColourGeneratedEvent schema", async () => {
    const asyncapi = parse(env.ASYNCAPI_YAML) as {
      components: { messages: Record<string, { payload: Record<string, unknown> }> };
    };
    const schema = asyncapi.components.messages.ColourGeneratedEvent.payload;

    const resp = await SELF.fetch("http://api/colours", { method: "POST" });
    expect(resp.status).toBe(200);

    const row = await env.OPERATIONAL_STORE
      .prepare("SELECT payload FROM outbox ORDER BY created_at DESC LIMIT 1")
      .first<{ payload: string }>();
    expect(row).not.toBeNull();

    const event = JSON.parse(row!.payload) as Record<string, unknown>;
    const result = new Validator(schema as never).validate(event);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(event.type).toBe("colour.generated");
  });
});
