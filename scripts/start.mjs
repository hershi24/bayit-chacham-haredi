import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const port = process.env.PORT?.trim() || "38471";
if (!/^\d+$/.test(port)) {
  console.error(`[pikud] PORT must be a number, received ${port}`);
  process.exit(1);
}

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "start", "--hostname", "0.0.0.0", "--port", port], {
  stdio: "inherit",
  env: process.env,
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
