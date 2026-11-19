import { WEEKDAY_LABELS, cleanWeekdays, weekdayOf } from "@/lib/programs/weekdays";

export type ViewSlot = {
  onTime: string | null;
  offTime: string | null;
  weekdays?: number[];
  deviceIds?: string[];
};

export type ViewClock = {
  onTime: string | null;
  offTime: string | null;
  deviceIds: string[];
};

export type ClockGroup = {
  key: string;
  title: string;
  clocks: ViewClock[];
};

type ProgramInput = {
  weekdays: number[];
  deviceIds: string[];
  slots: ViewSlot[];
};

type OwnedClock = {
  id: string;
  day: string;
  onTime: string | null;
  offTime: string | null;
  deviceIds: string[];
};

function clockOf(slot: ViewSlot, fallback: string[]): ViewClock | null {
  if (!slot.onTime && !slot.offTime) return null;
  return {
    onTime: slot.onTime,
    offTime: slot.offTime,
    deviceIds: slot.deviceIds?.length ? slot.deviceIds : fallback,
  };
}

function byTime(left: ViewClock, right: ViewClock) {
  return (left.onTime ?? left.offTime ?? "").localeCompare(right.onTime ?? right.offTime ?? "");
}

export function weekdayTitle(day: number) {
  return day === 6 ? "שבת" : `יום ${WEEKDAY_LABELS[day] ?? ""}`;
}

export function daysTitle(days: number[]) {
  const clean = cleanWeekdays(days);
  if (clean.length === 7) return "כל יום";
  if (!clean.length) return "";
  return clean.map(weekdayTitle).join(" · ");
}

export function dateTitle(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${weekdayTitle(weekdayOf(iso))} ${day}.${month}`;
}

/** Weekly clocks stay with the days they belong to. One-off clocks stay with their date. */
export function clockGroups(program: ProgramInput, owned: OwnedClock[]): ClockGroup[] {
  if (program.weekdays.length) {
    const seen = new Map<string, ViewSlot[]>();
    for (const slot of program.slots) {
      const days = cleanWeekdays(slot.weekdays?.length ? slot.weekdays : program.weekdays);
      if (!days.length) continue;
      const key = days.join(",");
      const list = seen.get(key) ?? [];
      list.push(slot);
      seen.set(key, list);
    }
    return [...seen.entries()]
      .map(([key, slots]) => {
        const days = key.split(",").map(Number);
        const clocks = slots.map((slot) => clockOf(slot, program.deviceIds)).filter((slot): slot is ViewClock => Boolean(slot)).sort(byTime);
        return { key, title: daysTitle(days), clocks, order: days[0] ?? 0 };
      })
      .filter((group) => group.clocks.length)
      .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
      .map(({ key, title, clocks }) => ({ key, title, clocks }));
  }

  const byDay = new Map<string, ViewClock[]>();
  for (const clock of owned) {
    const row = clockOf(clock, clock.deviceIds.length ? clock.deviceIds : program.deviceIds);
    if (!row) continue;
    const list = byDay.get(clock.day) ?? [];
    list.push(row);
    byDay.set(clock.day, list);
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, clocks]) => ({ key: day, title: dateTitle(day), clocks: clocks.sort(byTime) }));
}

export function clocksShareDevices(groups: ClockGroup[]) {
  const ids = groups.flatMap((group) => group.clocks.map((clock) => clock.deviceIds.join(",")));
  return new Set(ids).size <= 1;
}
