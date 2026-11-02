import { sessionPing } from "@/lib/wlte/parse";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function startLiveSocket(options: {
  ticket: () => Promise<string>;
  urlFor: (ticket: string) => string;
  onMessage: (payload: unknown) => void;
  onStatus: (state: "connecting" | "open" | "closed", error?: string) => void;
  onOpen: () => Promise<void>;
}): () => void {
  let stopped = false;
  let active: WebSocket | null = null;
  let delay = 1000;

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
        try {
          options.onMessage(JSON.parse(event.data) as unknown);
        } catch {
          // Ignore non-JSON frames.
        }
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

  return () => {
    stopped = true;
    active?.close();
  };
}
