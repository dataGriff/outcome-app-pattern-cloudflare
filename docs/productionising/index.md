# Productionising

This port runs on Cloudflare's free plan and inherits the same demo boundaries as the source
pattern. Rather than duplicate the checklist, see the source repo's canonical guide:

- **[Productionising checklist](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/productionising/index.md)** —
  delivery semantics, contract evolution, observability, security, and scale-out.

Cloudflare-specific production levers noted elsewhere in these docs:

- **Cold tiering** the sealed archive to R2 Infrequent Access via a lifecycle rule — a paid
  lever, distinct from the free-plan *logical* tiering. See [data products](../data-products/index.md#cold-tiering-paid-lever).
- **Durable Object wall-clock** is the tightest free-tier budget (the SSE holder + relay
  alarms) — the first thing to watch under real load.
