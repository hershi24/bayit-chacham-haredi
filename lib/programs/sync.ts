import { customWindow, upcomingPrograms, type ClockSettings, type ProgramWindow } from "@/lib/hebrew/calendar";
import type { StoredProgram } from "@/lib/programs/types";
import {
  getClock,
  listProgramRuns,
  listPrograms,
  listTenantDevices,
  listTenants,
  replaceProgramRuns,
} from "@/lib/store";

const refreshed = new Map<string, number>();

export async function syncTenantPrograms(tenantId: string, now = new Date()) {
  const settings = await getClock(tenantId);
  const programs = await listPrograms(tenantId);
  const devices = await listTenantDevices(tenantId);
  for (const program of programs) {
    const runs = program.enabled ? await runsFor(program, settings, devices.map((device) => device.deviceId), now) : [];
    await replaceProgramRuns(program.id, runs);
  }
  refreshed.set(tenantId, Date.now());
}

export async function syncProgramsIfStale() {
  const tenants = await listTenants();
  for (const tenant of tenants) {
    const at = refreshed.get(tenant.id) ?? 0;
    if (Date.now() - at < 60 * 60 * 1000) continue;
    await syncTenantPrograms(tenant.id);
  }
}

export function programId(tenantId: string, key: string) {
  return `prog_${tenantId}_${key}`;
}

async function runsFor(program: StoredProgram, settings: ClockSettings, allDeviceIds: string[], now: Date) {
  const chosen = program.deviceIds.filter((id) => allDeviceIds.includes(id));
  const devices = chosen.length ? chosen : allDeviceIds;
  const windows = (await windowsFor(program, settings, now)).filter((window) => Date.parse(window.end) > now.getTime());
  const runs = [];
  for (const deviceId of devices) {
    for (const window of windows) {
      const label = runLabel(program.name, window);
      if (Date.parse(window.start) > now.getTime() - 60_000) {
        runs.push({ deviceId, action: settings.startAction, runAt: window.start, label });
      }
      runs.push({ deviceId, action: settings.endAction, runAt: window.end, label });
    }
  }
  return runs;
}

async function windowsFor(program: StoredProgram, settings: ClockSettings, now: Date): Promise<ProgramWindow[]> {
  if (program.programKey.startsWith("custom:") && program.startDate && program.endDate) {
    const window = await customWindow(program.name, program.startDate, program.endDate, settings, now);
    return window ? [window] : [];
  }
  return (await upcomingPrograms(settings, now)).find((item) => item.key === program.programKey)?.windows ?? [];
}

function runLabel(name: string, window: ProgramWindow) {
  const days = window.days === 1 ? "יום אחד" : `${window.days} ימים`;
  const extra = window.includesShabbat ? ", כולל שבת" : "";
  return `${name}: ${window.title}, ${days}${extra}`;
}

export async function openRuns(tenantId: string) {
  return listProgramRuns(tenantId);
}
