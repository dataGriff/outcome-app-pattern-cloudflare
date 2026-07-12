/** Cloudflare Access JWT verification — the one identity seam every Worker
 * shares. Access is the identity provider: it hosts the login UI, brokers the
 * IdP, and mints signed JWTs for humans (login) and machines (service tokens).
 * This module only *validates* those tokens, in-process, against Access's public
 * JWKS — so it also covers the paths the edge can't (service-binding traffic
 * bypasses the public hostname, so the Worker must verify the forwarded token
 * itself).
 *
 * Config-gated exactly like the web channel's TURNSTILE_SECRET: with ACCESS_AUD
 * unset the result is `disabled` and callers stay open, so the hermetic test
 * suite and local dev need no tokens. Set the two vars in prod to enforce.
 *
 * Issuer-agnostic by construction: swapping Access for another OIDC provider
 * (e.g. Supabase) later means changing only `teamDomain`/`aud` and the JWKS URL
 * — every enforcement point calling this stays put. */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AccessConfig {
  /** ACCESS_TEAM_DOMAIN, e.g. https://myteam.cloudflareaccess.com — also the `iss`. */
  teamDomain?: string;
  /** ACCESS_AUD — the Access application's Audience (AUD) tag. */
  aud?: string;
}

export interface AccessIdentity {
  /** The authenticated user's email (empty for a service-token caller). */
  email: string;
  /** The Access subject claim (empty for a service-token caller). */
  sub: string;
}

export type AuthResult =
  | { status: "disabled" }
  | { status: "ok"; identity: AccessIdentity }
  | { status: "unauthorized"; reason: string };

/** The header Access injects at the edge for browser flows; first-party channels
 * forward the same header over their service binding, and native/direct callers
 * send the token as a bearer. */
const ACCESS_HEADER = "cf-access-jwt-assertion";

const jwksCache = new Map<string, JWTVerifyGetKey>();

function jwksFor(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

function extractToken(request: Request): string | null {
  const assertion = request.headers.get(ACCESS_HEADER);
  if (assertion) return assertion;
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

/** Verify the Access JWT on a request. `key` is injectable for tests; in
 * production it defaults to Access's remote JWKS for the configured team. */
export async function verifyAccessJwt(
  request: Request,
  config: AccessConfig,
  key?: JWTVerifyGetKey,
): Promise<AuthResult> {
  const { teamDomain, aud } = config;
  if (!teamDomain || !aud) return { status: "disabled" };

  const token = extractToken(request);
  if (!token) return { status: "unauthorized", reason: "missing access token" };

  try {
    const { payload } = await jwtVerify(token, key ?? jwksFor(teamDomain), {
      issuer: teamDomain,
      audience: aud,
    });
    return {
      status: "ok",
      identity: {
        email: typeof payload.email === "string" ? payload.email : "",
        sub: typeof payload.sub === "string" ? payload.sub : "",
      },
    };
  } catch {
    return { status: "unauthorized", reason: "invalid access token" };
  }
}
