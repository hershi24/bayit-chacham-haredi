import { upcomingAgenda } from "@/lib/hebrew/calendar";
import { mergeBackupBlock } from "@/lib/shelly/backup-plan";
import { getClock, listDeviceProgramRuns } from "@/lib/store";
import type { DeviceView, RelayAction } from "@/lib/types";

/**
 * The latest program action that should already have happened.
 * A later edge wins, and at the same second OFF wins, matching the Shelly catch-up.
 */
export function desiredProgramAction(runs: Array<{ action: RelayAction; runAt: string }>, now: Date): RelayAction | null {
  const limit = now.getTime();
  const applicable = runs
    .map((run) => ({ action: run.action, at: Date.parse(run.runAt) }))
    .filter((run) => Number.isFinite(run.at) && run.at <= limit)
    .sort((left, right) => left.at - right.at || Number(right.action === "ON") - Number(left.action === "ON"));
  return applicable.at(-1)?.action ?? null;
}

/** A WLTE socket returned from the internet or from a power cut. Shelly has its own catch-up. */
export function wlteCameBack(
  before: { connectivity: string; vendor: string },
  event: { type: string; connectivity?: string; topic?: string },
): boolean {
  if (before.vendor !== "wlte") return false;
  if (event.type !== "connectivity" || event.connectivity !== "ONLINE") return false;
  return before.connectivity !== "ONLINE" || event.topic === "device.power.restored";
}

/** During Shabbat or a holiday, send the program state if the live relay does not already match it. */
export async function reconcileWlteDevice(device: DeviceView, now = new Date()): Promise<RelayAction | null> {
  if (device.vendor !== "wlte" || device.frozen || device.connectivity !== "ONLINE") return null;
  const settings = await getClock(device.tenantId);
  const agenda = await upcomingAgenda(settings, now, 21);
  const block = mergeBackupBlock(
    agenda.map((window) => ({ title: window.programName, start: window.start, end: window.end })),
    now,
  );
  if (!block) return null;
  const at = now.getTime();
  if (at < Date.parse(block.start) || at > Date.parse(block.end)) return null;
  const desired = desiredProgramAction(await listDeviceProgramRuns(device.deviceId, block.start, block.end), now);
  if (!desired) return null;
  if (device.relayOn === (desired === "ON")) return null;
  const { getBridge } = await import("@/lib/wlte/bridge");
  await getBridge().command({
    deviceId: device.deviceId,
    action: desired,
    source: "system",
    actor: "בדיקת שבת",
  });
  return desired;
}

/** Read the socket after it comes back, then correct it when Shabbat or a holiday is in progress. */
export async function reconcileWlteReturn(deviceId: string, now = new Date()): Promise<RelayAction | null> {
  const { getBridge } = await import("@/lib/wlte/bridge");
  const live = await getBridge().refresh(deviceId, false);
  if (!live) return null;
  return reconcileWlteDevice(live, now);
}
