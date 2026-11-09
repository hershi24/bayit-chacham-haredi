import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";

const port = process.env.PORT?.trim() || "38471";
if (!/^\d+$/.test(port)) {
  console.error(`[pikud] PORT must be a number, received ${port}`);
  process.exit(1);
}

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname: "0.0.0.0", port: Number(port) });
const handle = app.getRequestHandler();
const upgrade = app.getUpgradeHandler();
const SHELLY_PATH = "/api/shelly/ws";

await app.prepare();

const server = createServer((req, res) => {
  const parsed = parse(req.url ?? "/", true);
  void handle(req, res, parsed);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `http://${host}`);
  if (url.pathname === SHELLY_PATH) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
    return;
  }
  // Forward HMR / Next upgrades — never destroy them.
  void upgrade(request, socket, head);
});

wss.on("connection", (ws) => {
  const attach = globalThis.__pikudOnShelly;
  if (typeof attach === "function") {
    attach(ws);
    return;
  }
  console.warn("[shelly] hub not ready yet; closing socket");
  ws.close();
});

server.listen(Number(port), "0.0.0.0", () => {
  console.info(`[pikud] ready on http://0.0.0.0:${port} (Shelly WS ${SHELLY_PATH})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
