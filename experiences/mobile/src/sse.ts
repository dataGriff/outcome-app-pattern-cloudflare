/** Minimal SSE reader over fetch streaming. EventSource can't send an
 * Authorization header, and the per-user stream is authenticated — so the
 * bearer goes on a plain fetch and the text/event-stream body is parsed by
 * hand. Runs wherever fetch exposes a readable body (the web export; native
 * RN fetch doesn't stream, so there it reports unsupported and stays quiet). */
export interface SseFrame {
  type: string;
  data: {
    todo_id: string;
    user_id: string;
    title: string;
    completed: boolean;
    timestamp: string;
  };
}

export type SseStatus = 'live' | 'reconnecting…' | 'unsupported';

export function connectSse(
  url: string,
  opts: {
    getToken: () => string | null;
    onFrame: (frame: SseFrame) => void;
    onStatus: (status: SseStatus) => void;
  },
): () => void {
  const controller = new AbortController();
  let closed = false;

  const run = async () => {
    while (!closed) {
      try {
        const token = opts.getToken();
        const resp = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          opts.onStatus(resp.body ? 'reconnecting…' : 'unsupported');
          if (!resp.body) return;
        } else {
          opts.onStatus('live');
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx = buffer.indexOf('\n\n');
            while (idx !== -1) {
              const raw = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              if (raw.startsWith('data: ')) opts.onFrame(JSON.parse(raw.slice(6)) as SseFrame);
              idx = buffer.indexOf('\n\n');
            }
          }
        }
      } catch {
        if (closed) return;
      }
      if (!closed) {
        opts.onStatus('reconnecting…');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  void run();

  return () => {
    closed = true;
    controller.abort();
  };
}
