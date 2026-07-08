/** Operational store (D1) for the behaviour domain.
 *
 * The API's durable state and its transactional outbox live here. Writing the
 * colour and the outbox row in one atomic batch is what lets the relay ship
 * events without a dual-write to the queue inside the request.
 */
import type { components } from "../types/api";
import type { Env } from "./env";
import { buildEvent } from "./event";

type Colour = components["schemas"]["ColourEvent"]["colour"];

export interface ColourRow {
  colour: Colour;
  created_at: string;
}

/** Insert the colour and its outbox event in one atomic D1 batch.
 *
 * D1 batch statements cannot read each other's results, so the app clock
 * supplies the single timestamp that the operational row, the outbox row and
 * the event all share — one clock, same guarantee as the source's DB-assigned
 * timestamp.
 */
export async function createColour(env: Env, colour: Colour): Promise<ColourRow> {
  const ts = new Date().toISOString();
  const event = buildEvent(colour, ts);
  await env.OPERATIONAL_STORE.batch([
    env.OPERATIONAL_STORE
      .prepare("INSERT INTO colours (id, colour, created_at) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), colour, ts),
    env.OPERATIONAL_STORE
      .prepare("INSERT INTO outbox (id, subject, payload, created_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), event.type, JSON.stringify(event), ts),
  ]);
  return { colour, created_at: ts };
}

export async function latest(env: Env): Promise<ColourRow | null> {
  return env.OPERATIONAL_STORE
    .prepare("SELECT colour, created_at FROM colours ORDER BY created_at DESC, id DESC LIMIT 1")
    .first<ColourRow>();
}

export async function recent(env: Env, limit: number): Promise<ColourRow[]> {
  const { results } = await env.OPERATIONAL_STORE
    .prepare("SELECT colour, created_at FROM colours ORDER BY created_at DESC, id DESC LIMIT ?")
    .bind(limit)
    .all<ColourRow>();
  return results;
}
