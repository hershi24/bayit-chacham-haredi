import { WlteError } from "@/lib/wlte/errors";
import { isWsReply, sessionPing } from "@/lib/wlte/parse";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Pending = {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type LiveSocketHandle = {
  stop: () => void;
  isOpen: () => boolean;
  request: (frame: { type: "request"; requestId: string; topic: string; data: Record<string, unknown> }, timeoutMs?: number) => Promise<Record<string, unknown>>;
};

export function startLiveSocket(options: {
  ticket: () => Promise<string>;
  urlFor: (ticket: string) => string;
  onEvent: (payload: unknown) => void;
  onStatus: (state: "connecting" | "open" | "closed", error?: string) => void;
  onOpen: () => Promise<void>;
}): LiveSocketHandle {
  let stopped = false;
  let active: WebSocket | null = null;
  let delay = 1000;
  const pending = new Map<string, Pending>();

  const rejectAll = (error: Error) => {
    for (const [id, item] of pending) {
      clearTimeout(item.timer);
      item.reject(error);
      pending.delete(id);
    }
  };

  const loop = async () => {
    while (!stopped) {
      options.onStatus("connecting");
      try {
        const ticket = await options.ticket();
        if (stopped) return;
        const session = await openSocket(options.urlFor(ticket));
        if (stopped) {
          session.close();
          return;
        }
        if (!session.opened || session.durationMs < 5000) {
          await sleep(delay + Math.round(Math.random() * 400));
          delay = Math.min(delay * 2, 30_000);
        } else {
          delay = 1000;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "חיבור ה-WebSocket נכשל";
        options.onStatus("closed", message.includes("ticket") ? "חיבור ה-WebSocket נכשל" : message);
        await sleep(delay + Math.round(Math.random() * 400));
        delay = Math.min(delay * 2, 30_000);
      }
    }
  };

  function openSocket(url: string): Promise<{ opened: boolean; durationMs: number; close: () => void }> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      active = socket;
      let opened = false;
      let settled = false;
      const openedAt = { current: 0 };
      const ping = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(sessionPing(crypto.randomUUID())));
        }
      }, 30_000);

      const finish = (result: { opened: boolean; durationMs: number }) => {
        if (settled) return;
        settled = true;
        clearInterval(ping);
        if (active === socket) active = null;
        rejectAll(new WlteError("WS_CLOSED", 503));
        resolve({ ...result, close: () => socket.close() });
      };

      socket.addEventListener("open", () => {
        opened = true;
        openedAt.current = Date.now();
        options.onStatus("open");
        void options.onOpen().catch(() => undefined);
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let payload: unknown;
        try {
          payload = JSON.parse(event.data) as unknown;
        } catch {
          return;
        }
        if (isWsReply(payload)) {
          const id = payload.requestId as string;
          const waiter = pending.get(id);
          if (!waiter) return;
          clearTimeout(waiter.timer);
          pending.delete(id);
          waiter.resolve(payload);
          return;
        }
        options.onEvent(payload);
      });

      socket.addEventListener("close", () => {
        options.onStatus("closed");
        finish({
          opened,
          durationMs: opened ? Date.now() - openedAt.current : 0,
        });
      });

      socket.addEventListener("error", () => {
        if (!opened && !settled) {
          settled = true;
          clearInterval(ping);
          socket.close();
          reject(new Error("חיבור ה-WebSocket נכשל"));
        }
      });
    });
  }

  void loop();

  return {
    stop() {
      stopped = true;
      rejectAll(new WlteError("WS_CLOSED", 503));
      active?.close();
    },
    isOpen() {
      return Boolean(active && active.readyState === WebSocket.OPEN);
    },
    request(frame, timeoutMs = 15_000) {
      return new Promise((resolve, reject) => {
        if (!active || active.readyState !== WebSocket.OPEN) {
          reject(new WlteError("WS_CLOSED", 503));
          return;
        }
        if (pending.has(frame.requestId)) {
          reject(new WlteError("INVALID_REQUEST", 400, "requestId כפול ב-WebSocket"));
          return;
        }
        const timer = setTimeout(() => {
          pending.delete(frame.requestId);
          reject(new WlteError("WS_TIMEOUT", 504));
        }, timeoutMs);
        pending.set(frame.requestId, { resolve, reject, timer });
        try {
          active.send(JSON.stringify(frame));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(frame.requestId);
          reject(error instanceof Error ? error : new WlteError("WS_CLOSED", 503));
        }
      });
    },
  };
}
