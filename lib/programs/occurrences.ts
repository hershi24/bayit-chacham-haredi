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
  slots: Array<{ onTime: string | null; offTime: string | null; weekdays?: number[] }>;
  deviceIds: string[];
  skippedDates?: string[];
};

export type OccurrenceClock = {
  id: string;
  day: string;
  onTime: string | null;
  offTime: string | null;
  deviceIds: string[];
  programId: string | null;
  recurring: boolean;
};

export type Occurrence = {
  key: string;
  programId: string | null;
  clockId: string | null;
  sourceDay: string;
  time: string;
  name: string;
  action: "on" | "off";
  deviceIds: string[];
};

type Range = { onTime: string | null; offTime: string | null };

export function occurrencesOn(
  day: string,
  programs: OccurrenceProgram[],
  clocks: OccurrenceClock[],
  filter = "all",
): Occurrence[] {
  const seen = new Set<string>();
  const out: Occurrence[] = [];
  const previous = shiftDate(day, -1);

  function push(event: Omit<Occurrence, "key">) {
    if (filter !== "all" && !event.deviceIds.includes(filter)) return;
    const key = `${event.programId ?? event.clockId}|${event.action}|${event.time}|${event.sourceDay}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...event, key });
  }

  function pushRanges(sourceDay: string, ranges: Range[], programId: string | null, clockId: string | null, name: string, deviceIds: string[]) {
    for (const range of ranges) {
      if (sourceDay === day && range.onTime) {
        push({ programId, clockId, sourceDay, time: range.onTime, name, action: "on", deviceIds });
      }
      if (sourceDay === day && range.offTime && (!range.onTime || range.offTime > range.onTime)) {
        push({
          programId,
          clockId,
          sourceDay,
          time: range.offTime,
          name: `כיבוי · ${name}`,
          action: "off",
          deviceIds,
        });
      }
      if (sourceDay === previous && range.onTime && range.offTime && range.offTime <= range.onTime) {
        push({
          programId,
          clockId,
          sourceDay,
          time: range.offTime,
          name: `כיבוי · ${name}`,
          action: "off",
          deviceIds,
        });
      }
    }
  }

  for (const program of programs) {
    if (!program.enabled) continue;
    for (const sourceDay of [day, previous]) {
      if ((program.skippedDates ?? []).includes(sourceDay)) continue;
      if (!program.weekdays.includes(weekdayOf(sourceDay)) || !coversDay(sourceDay, program.startDate, program.endDate)) continue;
      pushRanges(
        sourceDay,
        slotsForWeekday(program.slots, weekdayOf(sourceDay)),
        program.id,
        null,
        program.name,
        program.deviceIds,
      );
    }
  }

  for (const clock of clocks) {
    if (clock.recurring || (clock.day !== day && clock.day !== previous)) continue;
    const program = clock.programId ? programs.find((item) => item.id === clock.programId) : undefined;
    if (program && (!program.enabled || (program.skippedDates ?? []).includes(clock.day))) continue;
    const deviceIds = clock.deviceIds.length ? clock.deviceIds : (program?.deviceIds ?? []);
    pushRanges(clock.day, [clock], program?.id ?? null, clock.id, program?.name ?? "שעון", deviceIds);
  }

  return out.sort((left, right) => left.time.localeCompare(right.time) || (left.action === right.action ? 0 : left.action === "on" ? -1 : 1));
}
