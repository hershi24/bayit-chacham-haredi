import { requireUser, withErrors } from "@/lib/session";
import { subscribe } from "@/lib/sse";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const bridge = getBridge();
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        send("status", bridge.status());
        unsubscribe = subscribe({
          id: crypto.randomUUID(),
          role: user.role,
          tenantId: user.tenantId,
          send,
        });
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            if (heartbeat) clearInterval(heartbeat);
          }
        }, 20_000);
        request.signal.addEventListener("abort", () => {
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        });
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
