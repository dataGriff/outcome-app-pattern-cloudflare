# Productionising

This port runs on Cloudflare's free plan and inherits the same demo boundaries as the source
pattern. Rather than duplicate the checklist, see the source repo's canonical guide:

- **[Productionising checklist](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/productionising/index.md)** —
  delivery semantics, contract evolution, observability, security, and scale-out.

Cloudflare-specific production levers noted elsewhere in these docs:

- **Cold tiering** the sealed archive to R2 Infrequent Access via a lifecycle rule — a paid
  lever, distinct from the free-plan *logical* tiering. See [data products](../data-products/index.md#cold-tiering-paid-lever).
- **Durable Object wall-clock** is the tightest free-tier budget (the per-user SSE holders +
  relay alarms) — the first thing to watch under real load. Note the per-user stream model
  multiplies pinned objects by concurrent *users*, not connections.

## Known gap — machine callers once Access is enforced

The CI verify job smokes the deployed API as the **dev fallback identity**, which only exists
while `ACCESS_AUD` is unset. Once Access is enforced in production the smoke needs an **Access
service token** (`CF-Access-Client-Id`/`-Secret`) — and service-token JWTs carry an **empty
`sub`**, so a machine caller currently has no per-user identity to scope todos by. The fix when
it's needed: map service-token callers to a synthetic machine user id at the `requireAuth`
seam. Documented here deliberately rather than built — the demo doesn't enforce Access yet.
