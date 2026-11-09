/** Path Shelly devices use for Outbound WebSocket (handled in scripts/serve.mjs). */
export const SHELLY_WS_PATH = "/api/shelly/ws";

export function shellyWsPath() {
  return SHELLY_WS_PATH;
}
