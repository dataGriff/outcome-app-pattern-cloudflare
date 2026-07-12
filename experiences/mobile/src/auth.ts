import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';

// Cloudflare Access as the mobile channel's identity provider. A native app
// can't ride the browser cookie the web channel uses, so it runs the OIDC
// (OAuth + PKCE) flow in a system browser against an Access "OIDC" application
// and sends the resulting token as a bearer on every API call. The domain
// validates it with the same shared verifier the Workers use.
//
// Config-gated like every other channel: with the EXPO_PUBLIC_ACCESS_* vars
// unset the hook is inert and the app talks to the open demo API unchanged.
WebBrowser.maybeCompleteAuthSession();

const TEAM = process.env.EXPO_PUBLIC_ACCESS_TEAM_DOMAIN; // https://<team>.cloudflareaccess.com
const CLIENT_ID = process.env.EXPO_PUBLIC_ACCESS_CLIENT_ID;

export const accessEnabled = Boolean(TEAM && CLIENT_ID);

let currentToken: string | null = null;
/** The bearer attached to API requests; null until the user signs in (or when
 * Access is unprovisioned). Read by the openapi-fetch middleware in App.tsx. */
export function getAccessToken(): string | null {
  return currentToken;
}

const discovery: AuthSession.DiscoveryDocument | null = TEAM
  ? {
      authorizationEndpoint: `${TEAM}/cdn-cgi/access/sso/oidc/${CLIENT_ID}/authorization`,
      tokenEndpoint: `${TEAM}/cdn-cgi/access/sso/oidc/${CLIENT_ID}/token`,
    }
  : null;

/** Drives the Access OIDC sign-in. Returns whether auth is enabled, whether the
 * request is ready, and a `signIn` to launch the browser flow. */
export function useAccessAuth(): { enabled: boolean; ready: boolean; signIn: () => void } {
  const redirectUri = AuthSession.makeRedirectUri();
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    { clientId: CLIENT_ID ?? '', redirectUri, scopes: ['openid', 'email'], usePKCE: true },
    discovery ?? { authorizationEndpoint: '', tokenEndpoint: '' },
  );

  useEffect(() => {
    if (response?.type === 'success' && discovery && request?.codeVerifier) {
      AuthSession.exchangeCodeAsync(
        {
          clientId: CLIENT_ID ?? '',
          code: response.params.code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier },
        },
        discovery,
      )
        .then((tokens) => {
          currentToken = tokens.accessToken;
        })
        .catch(() => {});
    }
  }, [response, request, redirectUri]);

  return { enabled: accessEnabled, ready: Boolean(request), signIn: () => void promptAsync() };
}
