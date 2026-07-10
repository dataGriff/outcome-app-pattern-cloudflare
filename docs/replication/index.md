# Replication

This repo **is** the replication dry-run: the source pattern lifted wholesale onto a completely
different platform (Cloudflare's free plan, TypeScript). The verdict — the structure carried
over unchanged; only the implementations behind the role names were swapped. See the
[architecture role mapping](../architecture/index.md#this-implementation) for what changed and why.

The canonical lift-out guide, including the platform-swap analysis this port fed back into, lives
in the source repo:

- **[Replicating this pattern for your own domain](https://github.com/dataGriff/outcome-app-pattern/blob/main/docs/replication/index.md)** —
  the three zones, the order of work, the naming rules, the exact domain-specific touchpoints to
  swap, and the "Porting to a different platform" section (for which this repo was the dry run).
