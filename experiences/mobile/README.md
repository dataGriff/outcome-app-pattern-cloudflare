# experiences/mobile — Expo / React Native experience

The **mobile** channel consuming the one behaviour API. Same endpoints as web and
agent: `POST /colours` to generate, `GET /colours/latest`, and the SSE feed at
`GET /events/stream`.

HTTP calls go through a **typed client** (`openapi-fetch` over `src/api/schema.ts`,
generated from the committed OpenAPI contract with `task gen:types`) — the app
cannot call an endpoint or read a field the contract doesn't define. SSE stays a
raw `EventSource`; streams aren't part of the typed surface.

Unlike the web channel (which proxies same-origin through its worker), mobile
talks to the domain API **directly** — the CORS-enabled channel, demonstrating
cross-origin access to the same behaviour surface.

## Running locally

The API base URL comes from `EXPO_PUBLIC_API_URL`, baked at build time
(default `http://localhost:8787`, the domain worker's local `wrangler dev` port).
Run `task up` first so the behaviour API is live, then:

```bash
cd experiences/mobile
npm install
npx expo start      # then open in Expo Go / a simulator, or press w for web
```

For a native device, set `EXPO_PUBLIC_API_URL` to a host reachable from the
device (your machine's LAN IP, or the deployed `*.workers.dev` API URL) rather
than `localhost`.

## Deployed

Point `EXPO_PUBLIC_API_URL` at the deployed behaviour worker
(`https://colour-behaviour-service.<subdomain>.workers.dev`) and the same code
runs against production — the web export is served as static assets, the native
build runs unchanged.
