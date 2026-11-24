import { resolveActions, type ClockAction } from "@/lib/programs/actions";
import { WEEKDAY_LABELS, cleanWeekdays, weekdayOf } from "@/lib/programs/weekdays";
import { shiftDate } from "@/lib/time";

export type ViewSlot = {
  onTime: string | null;
  offTime: string | null;
  actions?: ClockAction[];
  weekdays?: number[];
  deviceIds?: string[];
};

export type ViewClock = {
  onTime: string | null;
  offTime: string | null;
  actions?: ClockAction[];
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
  actions?: ClockAction[];
  deviceIds: string[];
};

export type ScheduledAction = {
  time: string;
  action: "ON" | "OFF";
  deviceIds: string[];
};

export type ScheduledDay = {
  key: string;
  title: string;
  actions: ScheduledAction[];
};

function clockOf(slot: ViewSlot, fallback: string[]): ViewClock | null {
  if (!slot.onTime && !slot.offTime && !slot.actions?.length) return null;
  return {
    onTime: slot.onTime,
    offTime: slot.offTime,
    actions: slot.actions,
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

function sortActions(actions: ScheduledAction[]) {
  return [...actions].sort(
    (left, right) => left.time.localeCompare(right.time) || (left.action === right.action ? 0 : left.action === "ON" ? -1 : 1),
  );
}

function remember(bucket: Map<string, ScheduledAction[]>, key: string, action: ScheduledAction) {
  const list = bucket.get(key) ?? [];
  const signature = `${action.time}|${action.action}|${action.deviceIds.join(",")}`;
  if (!list.some((item) => `${item.time}|${item.action}|${item.deviceIds.join(",")}` === signature)) list.push(action);
  bucket.set(key, list);
}

/** Each day in week order, with that day's actions from earliest to latest. An earlier switch-off stays on the next morning. */
export function scheduledDays(program: ProgramInput, owned: OwnedClock[]): ScheduledDay[] {
  if (program.weekdays.length) {
    const origin = Math.min(...program.weekdays);
    const bucket = new Map<string, ScheduledAction[]>();
    for (const slot of program.slots) {
      const days = cleanWeekdays(slot.weekdays?.length ? slot.weekdays : program.weekdays);
      const deviceIds = slot.deviceIds?.length ? slot.deviceIds : program.deviceIds;
      for (const day of days) {
        for (const step of resolveActions(slot)) {
          const target = step.nextDay ? (day + 1) % 7 : day;
          remember(bucket, String(target), { time: step.time, action: step.action, deviceIds });
        }
      }
    }
    return [...bucket.entries()]
      .sort((left, right) => ((Number(left[0]) - origin + 7) % 7) - ((Number(right[0]) - origin + 7) % 7))
      .map(([day, actions]) => ({ key: day, title: weekdayTitle(Number(day)), actions: sortActions(actions) }));
  }

  const bucket = new Map<string, ScheduledAction[]>();
  for (const clock of owned) {
    const deviceIds = clock.deviceIds.length ? clock.deviceIds : program.deviceIds;
    for (const step of resolveActions(clock)) {
      if (!clock.day) continue;
      const day = step.nextDay ? shiftDate(clock.day, 1) : clock.day;
      remember(bucket, day, { time: step.time, action: step.action, deviceIds });
    }
  }
  return [...bucket.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, actions]) => ({ key: day, title: dateTitle(day), actions: sortActions(actions) }));
}
