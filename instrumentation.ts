export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBridge } = await import("./lib/wlte/bridge");
    const { startScheduler } = await import("./lib/schedules/run");
    const { getShellyHub } = await import("./lib/shelly/hub");
    const hub = getShellyHub();
    (globalThis as unknown as { __pikudOnShelly?: (socket: unknown) => void }).__pikudOnShelly = (socket) => {
      hub.attach(socket as import("ws").WebSocket);
    };
    startBridge();
    startScheduler();
  }
}
