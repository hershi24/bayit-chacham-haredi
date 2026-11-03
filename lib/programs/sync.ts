import type { DayClock } from "@/lib/programs/types";
import {
  listDayClocks,
  listPrograms,
  listTenantDevices,
  listTenants,
  replaceProgramRuns,
} from "@/lib/store";
import { jerusalemInstant, shiftDate } from "@/lib/time";

const refreshed = new Map<string, number>();

export async function syncTenantPrograms(tenantId: string, now = new Date()) {
  const programs = await listPrograms(tenantId);
  const clocks = await listDayClocks(tenantId);
  const allowed = new Set((await listTenantDevices(tenantId)).map((device) => device.deviceId));
  const byProgram = new Map<string, DayClock[]>();
  const loose: DayClock[] = [];
  for (const clock of clocks) {
    if (!clock.programId) {
      loose.push(clock);
      continue;
    }
    const bucket = byProgram.get(clock.programId) ?? [];
    bucket.push(clock);
    byProgram.set(clock.programId, bucket);
  }
  for (const program of programs) {
    const owned = program.programKey.startsWith("days:") ? (byProgram.get(program.id) ?? []) : [];
    const runs = program.enabled && program.programKey.startsWith("days:") ? runsFor(program.name, owned, allowed, now) : [];
    await replaceProgramRuns(program.id, runs);
  }
  await replaceProgramRuns(looseId(tenantId), runsFor("שעון", loose, allowed, now));
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

export function looseId(tenantId: string) {
  return `loose:${tenantId}`;
}

function runsFor(name: string, clocks: DayClock[], allowed: Set<string>, now: Date) {
  const runs = [];
  for (const clock of clocks) {
    for (const deviceId of clock.deviceIds.filter((id) => allowed.has(id))) {
      if (clock.onTime) {
        const at = jerusalemInstant(clock.day, clock.onTime);
        if (at && at.getTime() > now.getTime() - 60_000) {
          runs.push({ deviceId, action: "ON" as const, runAt: at.toISOString(), label: `${name}: הדלקה ${clock.onTime}` });
        }
      }
      if (clock.offTime) {
        const rolls = Boolean(clock.onTime && clock.offTime <= clock.onTime);
        const day = rolls ? shiftDate(clock.day, 1) : clock.day;
        const at = jerusalemInstant(day, clock.offTime);
        if (at && at.getTime() > now.getTime() - 60_000) {
          const suffix = rolls ? " למחרת" : "";
          runs.push({
            deviceId,
            action: "OFF" as const,
            runAt: at.toISOString(),
            label: `${name}: כיבוי ${clock.offTime}${suffix}`,
          });
        }
      }
    }
  }
  return runs;
}
