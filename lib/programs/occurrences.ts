import { actionDay, resolveActions, type ClockAction } from "@/lib/programs/actions";
import { skipsHoliday } from "@/lib/programs/holidays";
import { slotsForWeekday } from "@/lib/programs/slots";
import { coversDay } from "@/lib/programs/span";
import { weekdayOf } from "@/lib/programs/weekdays";
import { shiftDate } from "@/lib/time";

export type OccurrenceProgram = {
  id: string;
  name: string;
  enabled: boolean;
  weekdays: number[];
  startDate: string | null;
  endDate: string | null;
  slots: Array<{ onTime: string | null; offTime: string | null; actions?: ClockAction[]; weekdays?: number[]; deviceIds?: string[] }>;
  deviceIds: string[];
  skippedDates?: string[];
  skipHolidays?: boolean;
};

export type OccurrenceClock = {
  id: string;
  day: string;
  onTime: string | null;
  offTime: string | null;
  actions?: ClockAction[];
  deviceIds: string[];
  programId: string | null;
  recurring: boolean;
  label?: string;
};

export type OccurrenceSchedule = {
  id: string;
  deviceId: string;
  kind: "later_on" | "timer_off";
  day: string;
  time: string;
  label: string;
};

export type Occurrence = {
  key: string;
  programId: string | null;
  clockId: string | null;
  scheduleId: string | null;
  sourceDay: string;
  time: string;
  name: string;
  action: "on" | "off";
  deviceIds: string[];
};

type Range = { onTime: string | null; offTime: string | null; actions?: ClockAction[] };

export function occurrencesOn(
  day: string,
  programs: OccurrenceProgram[],
  clocks: OccurrenceClock[],
  filter = "all",
  yomTov: ReadonlySet<string> = new Set(),
  schedules: OccurrenceSchedule[] = [],
): Occurrence[] {
  const seen = new Set<string>();
  const out: Occurrence[] = [];
  const previous = shiftDate(day, -1);

  function push(event: Omit<Occurrence, "key" | "scheduleId"> & { scheduleId?: string | null }) {
    if (filter !== "all" && !event.deviceIds.includes(filter)) return;
    const scheduleId = event.scheduleId ?? null;
    const key = `${event.programId ?? event.clockId ?? scheduleId}|${event.action}|${event.time}|${event.sourceDay}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...event, scheduleId, key });
  }

  function pushRanges(sourceDay: string, ranges: Range[], programId: string | null, clockId: string | null, name: string, deviceIds: string[]) {
    for (const range of ranges) {
      for (const step of resolveActions(range)) {
        if (actionDay(sourceDay, step) !== day) continue;
        push({
          programId,
          clockId,
          sourceDay,
          time: step.time,
          name: step.action === "ON" ? name : `כיבוי · ${name}`,
          action: step.action === "ON" ? "on" : "off",
          deviceIds,
        });
      }
    }
  }

  for (const program of programs) {
    if (!program.enabled) continue;
    for (const sourceDay of [day, previous]) {
      if ((program.skippedDates ?? []).includes(sourceDay) || skipsHoliday(program, sourceDay, yomTov)) continue;
      if (!program.weekdays.includes(weekdayOf(sourceDay)) || !coversDay(sourceDay, program.startDate, program.endDate)) continue;
      for (const slot of slotsForWeekday(program.slots, weekdayOf(sourceDay))) {
        pushRanges(
          sourceDay,
          [slot],
          program.id,
          null,
          program.name,
          slot.deviceIds?.length ? slot.deviceIds : program.deviceIds,
        );
      }
    }
  }

  for (const clock of clocks) {
    if (clock.recurring || (clock.day !== day && clock.day !== previous)) continue;
    const program = clock.programId ? programs.find((item) => item.id === clock.programId) : undefined;
    if (program && (!program.enabled || (program.skippedDates ?? []).includes(clock.day) || skipsHoliday(program, clock.day, yomTov))) continue;
    const deviceIds = clock.deviceIds.length ? clock.deviceIds : (program?.deviceIds ?? []);
    pushRanges(clock.day, [clock], program?.id ?? null, clock.id, program?.name ?? clock.label ?? "שעון", deviceIds);
  }

  for (const item of schedules) {
    if (item.day !== day || !item.time) continue;
    const on = item.kind === "later_on";
    push({
      programId: null,
      clockId: null,
      scheduleId: item.id,
      sourceDay: day,
      time: item.time,
      name: on ? item.label : `כיבוי · ${item.label}`,
      action: on ? "on" : "off",
      deviceIds: [item.deviceId],
    });
  }

  return out.sort((left, right) => left.time.localeCompare(right.time) || (left.action === right.action ? 0 : left.action === "on" ? -1 : 1));
}
