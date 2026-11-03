import { HttpError } from "@/lib/http-error";
import { syncProgramsIfStale } from "@/lib/programs/sync";
import { failProgramRun, failSchedule, finishProgramRun, finishSchedule, getDevice, listDueProgramRuns, listDueSchedules } from "@/lib/store";
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
  try {
    await syncProgramsIfStale();
  } catch (error) {
    console.error("[pikud] programs", error);
  }
  const due = await listDueSchedules();
  const bridge = getBridge();
  for (const job of due) {
    try {
      if ((await getDevice(job.deviceId))?.frozen) continue;
      const result = await bridge.command({
        deviceId: job.deviceId,
        action: job.kind === "timer_off" ? "OFF" : "ON",
        source: "ivr",
        actor: job.kind === "timer_off" ? "טיימר" : "שעון",
      });
      if (result.status === "SUCCESS" || result.status === "SENT") await finishSchedule(job.id);
      else await failSchedule(job.id, result.status);
    } catch (error) {
      if (error instanceof HttpError && error.message === "השקע מוקפא") continue;
      await failSchedule(job.id, error instanceof Error ? error.message : "הפעולה נכשלה");
    }
  }
  for (const job of await listDueProgramRuns()) {
    try {
      if ((await getDevice(job.deviceId))?.frozen) continue;
      const result = await bridge.command({
        deviceId: job.deviceId,
        action: job.action,
        source: "ivr",
        actor: "תוכנית",
      });
      if (result.status === "SUCCESS" || result.status === "SENT") await finishProgramRun(job.id);
      else await failProgramRun(job.id, result.status);
    } catch (error) {
      if (error instanceof HttpError && error.message === "השקע מוקפא") continue;
      await failProgramRun(job.id, error instanceof Error ? error.message : "הפעולה נכשלה");
    }
  }
}
