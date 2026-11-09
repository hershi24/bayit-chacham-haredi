import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = process.env.PORT?.trim() || "38471";
if (!/^\d+$/.test(port)) {
  console.error(`[pikud] PORT must be a number, received ${port}`);
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const serve = path.join(here, "serve.mjs");
const child = spawn(process.execPath, [serve], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", PORT: port },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
