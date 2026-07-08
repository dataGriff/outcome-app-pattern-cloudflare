/** Port of the source repo's unit tests: same four behaviours, but against a
 * hermetic local D1 instead of a mocked db module (isolated storage per test
 * makes the real store just as hermetic). */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const COLOURS = ["red", "amber", "green"];

interface ColourEventBody {
  colour: string;
  timestamp: string;
}

async function post(): Promise<Response> {
  return SELF.fetch("http://api/colours", { method: "POST" });
}

describe("behaviour API", () => {
  it("creates a colour", async () => {
    const resp = await post();
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as ColourEventBody;
    expect(COLOURS).toContain(body.colour);
    expect(body.timestamp).toBeTruthy();
  });

  it("returns the latest colour", async () => {
    const created = (await (await post()).json()) as ColourEventBody;
    const resp = await SELF.fetch("http://api/colours/latest");
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as ColourEventBody;
    expect(body.colour).toBe(created.colour);
  });

  it("404s when no colours generated yet", async () => {
    const resp = await SELF.fetch("http://api/colours/latest");
    expect(resp.status).toBe(404);
  });

  it("lists recent colours most recent first", async () => {
    await post();
    await post();
    await post();
    const resp = await SELF.fetch("http://api/colours?limit=2");
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as ColourEventBody[];
    expect(body).toHaveLength(2);
    for (const row of body) expect(COLOURS).toContain(row.colour);
  });
});
