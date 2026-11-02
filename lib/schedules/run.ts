import { failSchedule, finishSchedule, listDueSchedules } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";

const globalScheduler = globalThis as { __pikudScheduler?: boolean };

export function startScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (globalScheduler.__pikudScheduler) return;
  globalScheduler.__pikudScheduler = true;
  const tick = () => {
    void runDueSchedules().catch((error: unknown) => {
      console.error("[pikud] schedule", error);
    });
  };
  tick();
  const timer = setInterval(tick, 15_000);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

export async function runDueSchedules() {
  const due = await listDueSchedules();
  const bridge = getBridge();
  for (const job of due) {
    try {
      const result = await bridge.command({
        deviceId: job.deviceId,
        action: job.kind === "timer_off" ? "OFF" : "ON",
        source: "ivr",
        actor: job.kind === "timer_off" ? "טיימר" : "שעון",
      });
      if (result.status === "SUCCESS" || result.status === "SENT") await finishSchedule(job.id);
      else await failSchedule(job.id, result.status);
    } catch (error) {
      await failSchedule(job.id, error instanceof Error ? error.message : "הפעולה נכשלה");
    }
  }
}
