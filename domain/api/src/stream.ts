/** SSE bridge: one Durable Object per user fans that user's todo events out
 * to their SSE clients (the relay addresses objects by idFromName(user_id)).
 *
 * The queue is not browser-native, so this bridge is what lets web, mobile and
 * agent experiences all consume the same live event feed over plain HTTP.
 * Connections pin the object (SSE cannot hibernate); when the last client
 * drops, the heartbeat stops and the object can be evicted.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const HEARTBEAT_MS = 30_000;
const encoder = new TextEncoder();

export class StreamDO extends DurableObject<Env> {
  private writers = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  async fetch(_request: Request): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.writers.add(writer);
    writer.write(encoder.encode(": connected\n\n")).catch(() => this.writers.delete(writer));
    if (this.heartbeat === null) {
      this.heartbeat = setInterval(() => this.send(encoder.encode(": ping\n\n")), HEARTBEAT_MS);
    }
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  broadcast(payload: unknown): void {
    this.send(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  }

  private send(chunk: Uint8Array): void {
    for (const writer of [...this.writers]) {
      writer.write(chunk).catch(() => this.writers.delete(writer));
    }
    if (this.writers.size === 0 && this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
