import { yomTovDates } from "@/lib/hebrew/calendar";
import { actionDay, resolveActions } from "@/lib/programs/actions";
import { skipsHoliday } from "@/lib/programs/holidays";
import { slotsForWeekday } from "@/lib/programs/slots";
import { coversDay } from "@/lib/programs/span";
import type { DayClock, StoredProgram } from "@/lib/programs/types";
import { sharedClockDays, weekdayOf } from "@/lib/programs/weekdays";
import {
  listDayClocks,
  listPrograms,
  listTenantDevices,
  listTenantIds,
  replaceProgramRuns,
} from "@/lib/store";
import { israelDate, jerusalemInstant, shiftDate } from "@/lib/time";

const refreshed = new Map<string, number>();
const tenantFlight = new Map<string, { running: boolean; again: boolean; now: Date; shelly: boolean }>();
let scanRunning = false;

export async function syncTenantPrograms(tenantId: string, now = new Date(), shelly = true) {
  const slot = tenantFlight.get(tenantId) ?? { running: false, again: false, now, shelly };
  tenantFlight.set(tenantId, slot);
  if (slot.running) {
    slot.again = true;
    slot.now = now;
    slot.shelly = slot.shelly || shelly;
    return;
  }
  slot.running = true;
  slot.now = now;
  slot.shelly = shelly;
  try {
    do {
      slot.again = false;
      await syncTenantProgramsOnce(tenantId, slot.now, slot.shelly);
    } while (slot.again);
  } finally {
    slot.running = false;
  }
}

async function syncTenantProgramsOnce(tenantId: string, now = new Date(), shelly = true) {
  const programs = await listPrograms(tenantId);
  const clocks = await listDayClocks(tenantId);
  const allowed = new Set((await listTenantDevices(tenantId)).map((device) => device.deviceId));
  const byProgram = new Map<string, DayClock[]>();
  const loose: DayClock[] = [];
  const yomTov = await holidayDates(clocks, now);
  for (const clock of clocks) {
    if (!clock.programId) {
      loose.push(clock);
      continue;
    }
    const bucket = byProgram.get(clock.programId) ?? [];
    bucket.push(clock);
    byProgram.set(clock.programId, bucket);
  }
  await Promise.all(
    programs.map((program) => {
      const skipped = new Set(program.skippedDates ?? []);
      const owned = program.programKey.startsWith("days:")
        ? (byProgram.get(program.id) ?? []).filter((clock) => !skipped.has(clock.day) && !skipsHoliday(program, clock.day, yomTov))
        : [];
      const runs =
        program.enabled && program.programKey.startsWith("days:")
          ? [...runsFor(program.name, owned, allowed, now), ...runsForWeekdays(program, allowed, now, yomTov)]
          : [];
      return replaceProgramRuns(program.id, runs);
    }),
  );
  await replaceProgramRuns(looseId(tenantId), runsFor("שעון", loose, allowed, now));
  refreshed.set(tenantId, Date.now());
  if (!shelly) return;
  void import("@/lib/shelly/backup-sync")
    .then((mod) => mod.syncShellyBackupsForTenant(tenantId, now))
    .catch((error: unknown) => {
      console.error("[pikud] shelly backup", error);
    });
}

export async function syncProgramsIfStale() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const tenants = await listTenantIds();
    for (const tenantId of tenants) {
      const at = refreshed.get(tenantId) ?? 0;
      if (Date.now() - at < 60 * 60 * 1000) continue;
      await syncTenantPrograms(tenantId);
    }
  } finally {
    scanRunning = false;
  }
}

export function programId(tenantId: string, key: string) {
  return `prog_${tenantId}_${key}`;
}

export function looseId(tenantId: string) {
  return `loose:${tenantId}`;
}

async function holidayDates(clocks: DayClock[], now: Date) {
  let from = israelDate(now);
  let to = shiftDate(from, 84);
  for (const clock of clocks) {
    if (clock.day < from) from = clock.day;
    if (clock.day > to) to = clock.day;
  }
  if (to > shiftDate(from, 800)) to = shiftDate(from, 800);
  return new Set(await yomTovDates(from, to));
}

function runsForWeekdays(program: StoredProgram, allowed: Set<string>, now: Date, yomTov: ReadonlySet<string>) {
  if (!program.weekdays.length || !program.slots.length) return [];
  const clocks: DayClock[] = [];
  let day = israelDate(now);
  for (let index = 0; index < 84; index += 1) {
    if (
      program.weekdays.includes(weekdayOf(day)) &&
      coversDay(day, program.startDate, program.endDate) &&
      !(program.skippedDates ?? []).includes(day) &&
      !skipsHoliday(program, day, yomTov)
    ) {
      for (const slot of slotsForWeekday(sharedClockDays(program.slots, program.weekdays), weekdayOf(day))) {
        clocks.push({
          id: program.id,
          tenantId: program.tenantId,
          programId: program.id,
          day,
          onTime: slot.onTime,
          offTime: slot.offTime,
          actions: slot.actions,
          deviceIds: slot.deviceIds?.length ? slot.deviceIds : program.deviceIds,
        });
      }
    }
    day = shiftDate(day, 1);
  }
  return runsFor(program.name, clocks, allowed, now);
}

function runsFor(name: string, clocks: DayClock[], allowed: Set<string>, now: Date) {
  const runs = [];
  for (const clock of clocks) {
    for (const deviceId of clock.deviceIds.filter((id) => allowed.has(id))) {
      for (const step of resolveActions(clock)) {
        const day = actionDay(clock.day, step);
        const at = jerusalemInstant(day, step.time);
        if (!at || at.getTime() <= now.getTime() - 60_000) continue;
        const word = step.action === "ON" ? "הדלקה" : "כיבוי";
        const suffix = step.nextDay ? " למחרת" : "";
        runs.push({ deviceId, action: step.action, runAt: at.toISOString(), label: `${name}: ${word} ${step.time}${suffix}` });
      }
    }
  }
  return runs;
}
