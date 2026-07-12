# Replication

This repo **is** the replication dry-run: the source pattern lifted onto a completely
different platform (Cloudflare's free plan, TypeScript). The port originally kept the source's
colour domain for parity; the repo has since swapped the domain too — a per-user todo-list
domain with authenticated CRUD, per-user live streams, and PII-free data products — so it now
exercises the replication guide along **both axes**: platform swap and domain swap. The verdict
holds either way — the structure (zones, roles, contract-first order of work) carried over
unchanged; only the implementations behind the role names and the domain-specific touchpoints
were swapped. See the
[architecture role mapping](../architecture/index.md#this-implementation) for what changed and why.

The canonical lift-out guide, including the platform-swap analysis this port fed back into, lives
in the source repo:

- **[Replicating this pattern for your own domain](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/replication/index.md)** —
  the three zones, the order of work, the naming rules, the exact domain-specific touchpoints to
  swap, and the "Porting to a different platform" section (for which this repo was the dry run).
