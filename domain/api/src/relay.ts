/** Outbox relay: drain unpublished outbox rows to the events queue.
 *
 * A singleton SQLite-backed Durable Object is the workerd equivalent of the
 * source's single relay replica with FOR UPDATE SKIP LOCKED: its
 * single-threaded execution serialises drains, so delivery is at-least-once
 * with no row contention. The API pokes it after each write for immediate
 * drain; a self-rearming alarm is the backstop that also prunes.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const BATCH = 50;
const BUSY_ALARM_MS = 5_000;
const IDLE_ALARM_MS = 60_000;
const PRUNE_INTERVAL_MS = 60_000;

interface OutboxRow {
  id: string;
  subject: string;
  payload: string;
}

export class OutboxRelayDO extends DurableObject<Env> {
  private lastPrune = 0;

  async poke(): Promise<void> {
    await this.drain();
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_ALARM_MS);
    }
  }

  async alarm(): Promise<void> {
    const published = await this.drain();
    await this.maybePrune();
    await this.ctx.storage.setAlarm(
      Date.now() + (published > 0 ? BUSY_ALARM_MS : IDLE_ALARM_MS),
    );
  }

  private async drain(): Promise<number> {
    const { results } = await this.env.OPERATIONAL_STORE
      .prepare(
        "SELECT id, subject, payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT ?",
      )
      .bind(BATCH)
      .all<OutboxRow>();
    if (results.length === 0) return 0;

    // Publish first, mark after — a crash in between redelivers (at-least-once),
    // never drops.
    await this.env.EVENTS.sendBatch(
      results.map((r) => ({ body: JSON.parse(r.payload) })),
    );
    const placeholders = results.map(() => "?").join(",");
    await this.env.OPERATIONAL_STORE
      .prepare(`UPDATE outbox SET published_at = ? WHERE id IN (${placeholders})`)
      .bind(new Date().toISOString(), ...results.map((r) => r.id))
      .run();

    // Best-effort live fan-out to SSE clients — not durable, exactly like the
    // source's NATS→SSE bridge. The queue is the durable path.
    const stream = this.env.STREAM.get(this.env.STREAM.idFromName("stream"));
    this.ctx.waitUntil(
      Promise.allSettled(
        results.map((r) => stream.broadcast(JSON.parse(r.payload).data)),
      ),
    );
    return results.length;
  }

  private async maybePrune(): Promise<void> {
    if (Date.now() - this.lastPrune < PRUNE_INTERVAL_MS) return;
    this.lastPrune = Date.now();
    // Published rows are a delivery log, not history — the operational table
    // and the data products hold the record. Prune so the outbox stays bounded.
    const retention = Number(this.env.OUTBOX_RETENTION_SECONDS ?? "3600");
    const cutoff = new Date(Date.now() - retention * 1000).toISOString();
    await this.env.OPERATIONAL_STORE
      .prepare("DELETE FROM outbox WHERE published_at IS NOT NULL AND published_at < ?")
      .bind(cutoff)
      .run();
  }
}
