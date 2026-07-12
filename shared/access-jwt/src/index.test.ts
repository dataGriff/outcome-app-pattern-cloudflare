import { SignJWT, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { describe, expect, it } from "vitest";
import { DEV_IDENTITY, verifyAccessJwt, type AccessConfig } from "./index";

const TEAM = "https://todo.cloudflareaccess.com";
const AUD = "test-aud-tag";
const CONFIG: AccessConfig = { teamDomain: TEAM, aud: AUD };

const keys = await generateKeyPair("RS256");
// A resolver that ignores the (unreachable in tests) remote JWKS and returns our
// local public key, so the verification path is exercised without network.
const localKey: JWTVerifyGetKey = async () => keys.publicKey;

async function sign(claims: Record<string, unknown>, opts?: { aud?: string; iss?: string; exp?: string }) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(opts?.iss ?? TEAM)
    .setAudience(opts?.aud ?? AUD)
    .setExpirationTime(opts?.exp ?? "1h")
    .sign(keys.privateKey);
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://todo-api.domainapps.org/todos", { method: "POST", headers });
}

describe("verifyAccessJwt", () => {
  it("is disabled (open) when ACCESS_AUD is unset", async () => {
    const r = await verifyAccessJwt(req(), { teamDomain: TEAM });
    expect(r.status).toBe("disabled");
  });

  it("rejects a request with no token when enabled", async () => {
    const r = await verifyAccessJwt(req(), CONFIG, localKey);
    expect(r).toEqual({ status: "unauthorized", reason: "missing access token" });
  });

  it("accepts a valid token and extracts identity (Cf-Access-Jwt-Assertion)", async () => {
    const token = await sign({ email: "dog@domainapps.org" });
    const r = await verifyAccessJwt(req({ "cf-access-jwt-assertion": token }), CONFIG, localKey);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.identity.email).toBe("dog@domainapps.org");
  });

  it("accepts a valid token as a bearer (mobile / direct callers)", async () => {
    const token = await sign({ email: "dog@domainapps.org" });
    const r = await verifyAccessJwt(req({ authorization: `Bearer ${token}` }), CONFIG, localKey);
    expect(r.status).toBe("ok");
  });

  it("rejects an expired token", async () => {
    const token = await sign({ email: "dog@domainapps.org" }, { exp: "0s" });
    const r = await verifyAccessJwt(req({ "cf-access-jwt-assertion": token }), CONFIG, localKey);
    expect(r.status).toBe("unauthorized");
  });

  it("rejects a token with the wrong audience", async () => {
    const token = await sign({ email: "dog@domainapps.org" }, { aud: "some-other-app" });
    const r = await verifyAccessJwt(req({ "cf-access-jwt-assertion": token }), CONFIG, localKey);
    expect(r.status).toBe("unauthorized");
  });

  it("rejects a token from the wrong issuer", async () => {
    const token = await sign({ email: "dog@domainapps.org" }, { iss: "https://evil.cloudflareaccess.com" });
    const r = await verifyAccessJwt(req({ "cf-access-jwt-assertion": token }), CONFIG, localKey);
    expect(r.status).toBe("unauthorized");
  });
});

describe("DEV_IDENTITY", () => {
  it("is the fixed dev-mode identity", () => {
    expect(DEV_IDENTITY).toEqual({ sub: "dev", email: "dev@localhost" });
  });
});
