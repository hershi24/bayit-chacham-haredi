export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBridge } = await import("./lib/wlte/bridge");
    startBridge();
  }
}
