import { HttpError } from "@/lib/http-error";
import { syncProgramsIfStale } from "@/lib/programs/sync";
import { shellyBackupCoversRun, syncShellyBackups } from "@/lib/shelly/backup-sync";
import { createRoundGuard } from "@/lib/schedules/guard";
import { failProgramRun, failSchedule, finishProgramRun, finishSchedule, getDevice, listDueProgramRuns, listDueSchedules } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";

const globalScheduler = globalThis as { __pikudScheduler?: boolean };

/** Due clocks and program runs. This stays on its own loop so a long sync cannot delay a command. */
export const DUE_INTERVAL_MS = 15_000;
/** The hourly program rebuild is checked once a minute. A saved program still syncs immediately. */
export const PROGRAM_SYNC_INTERVAL_MS = 60_000;
/** Matches the previous per-unit pause, without scanning every tenant on the due loop. */
export const SHELLY_SYNC_INTERVAL_MS = 60_000;

export function startScheduler() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (globalScheduler.__pikudScheduler) return;
  globalScheduler.__pikudScheduler = true;
  startLoop(DUE_INTERVAL_MS, () => runDueSchedules(), "[pikud] schedule");
  startLoop(PROGRAM_SYNC_INTERVAL_MS, () => syncProgramsIfStale(), "[pikud] programs");
  startLoop(SHELLY_SYNC_INTERVAL_MS, () => syncShellyBackups(), "[pikud] shelly backup");
}

function startLoop(every: number, job: () => Promise<void>, label: string) {
  const guard = createRoundGuard();
  const tick = () => {
    void guard(async () => {
      try {
        await job();
      } catch (error) {
        console.error(label, error);
      }
    });
  };
  tick();
  const timer = setInterval(tick, every);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

export async function runDueSchedules() {
  const due = await listDueSchedules();
  const bridge = getBridge();
  for (const job of due) {
    try {
      if ((await getDevice(job.deviceId, { plans: false }))?.frozen) continue;
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
      if (await shellyBackupCoversRun(job.deviceId, job.runAt)) {
        await finishProgramRun(job.id);
        continue;
      }
      if ((await getDevice(job.deviceId, { plans: false }))?.frozen) continue;
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
