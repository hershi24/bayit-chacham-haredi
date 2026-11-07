import { coversDay } from "@/lib/programs/span";
import { weekdayOf } from "@/lib/programs/weekdays";
import { shiftDate } from "@/lib/time";

export type TimelineClock = {
  id: string;
  day: string;
  onTime: string | null;
  offTime: string | null;
  deviceIds: string[];
  programId: string | null;
  recurring: boolean;
};

export type TimelineProgram = {
  id: string;
  name: string;
  enabled: boolean;
  weekdays: number[];
  onTime: string | null;
  offTime: string | null;
  slots?: Array<{ onTime: string | null; offTime: string | null; weekdays?: number[] }>;
  deviceIds: string[];
  startDate?: string | null;
  endDate?: string | null;
  skippedDates?: string[];
};

export type DayBar = {
  key: string;
  deviceId: string;
  name: string;
  start: number;
  end: number;
  muted: boolean;
  title: string;
  source: "clock" | "program";
  sourceId: string;
};

function minutes(time: string | null): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatMin(value: number): string {
  if (value >= 1440) return "24:00";
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function pushSpan(
  bars: DayBar[],
  input: {
    key: string;
    source: "clock" | "program";
    sourceId: string;
    deviceIds: string[];
    name: string;
    muted: boolean;
    on: number | null;
    off: number | null;
    portion: "same" | "next";
  },
) {
  const { on, off, portion } = input;
  let start: number | null = null;
  let end: number | null = null;
  if (on != null && off != null && off > on) {
    if (portion === "same") {
      start = on;
      end = off;
    }
  } else if (on != null && off != null) {
    if (portion === "same") {
      start = on;
      end = 1440;
    } else if (off > 0) {
      start = 0;
      end = off;
    }
  } else if (on != null && portion === "same") {
    start = on;
    end = 1440;
  } else if (off != null && portion === "same") {
    start = 0;
    end = off;
  }
  if (start == null || end == null || end <= start) return;
  const title = `${input.name} ${formatMin(start)}–${formatMin(end)}`;
  for (const deviceId of input.deviceIds) {
    bars.push({
      key: `${input.key}:${deviceId}:${input.portion}`,
      deviceId,
      name: input.name,
      start,
      end,
      muted: input.muted,
      title,
      source: input.source,
      sourceId: input.sourceId,
    });
  }
}

export function dayBars(date: string, clocks: TimelineClock[], programs: TimelineProgram[]): DayBar[] {
  const previous = shiftDate(date, -1);
  const bars: DayBar[] = [];
  const owners = new Map(programs.map((program) => [program.id, program]));

  for (const clock of clocks) {
    if (clock.recurring) continue;
    const owner = clock.programId ? owners.get(clock.programId) : undefined;
    if (owner && (owner.skippedDates ?? []).includes(clock.day)) continue;
    const shared = {
      key: clock.id,
      source: "clock" as const,
      sourceId: clock.id,
      deviceIds: clock.deviceIds,
      name: owner?.name ?? "שעון",
      muted: Boolean(owner && !owner.enabled),
      on: minutes(clock.onTime),
      off: minutes(clock.offTime),
    };
    if (clock.day === date) pushSpan(bars, { ...shared, portion: "same" });
    else if (clock.day === previous) pushSpan(bars, { ...shared, portion: "next" });
  }

  const weekday = weekdayOf(date);
  const previousWeekday = weekdayOf(previous);
  for (const program of programs) {
    if (!program.weekdays.length) continue;
    const skipped = new Set(program.skippedDates ?? []);
    const groups = [
      ...(program.weekdays.includes(previousWeekday) &&
      coversDay(previous, program.startDate ?? null, program.endDate ?? null) &&
      !skipped.has(previous)
        ? [{ offset: -1440, slots: slotsFor(program, previousWeekday) }]
        : []),
      ...(program.weekdays.includes(weekday) && coversDay(date, program.startDate ?? null, program.endDate ?? null) && !skipped.has(date)
        ? [{ offset: 0, slots: slotsFor(program, weekday) }]
        : []),
    ];
    programSpans(groups).forEach(([start, end], index) => {
      const title = `${program.name} ${formatMin(start)}–${formatMin(end)}`;
      for (const deviceId of program.deviceIds) {
        bars.push({
          key: `${program.id}:${index}:${deviceId}`,
          deviceId,
          name: program.name,
          start,
          end,
          muted: !program.enabled,
          title,
          source: "program",
          sourceId: program.id,
        });
      }
    });
  }

  return bars;
}

function slotsFor(program: TimelineProgram, weekday: number) {
  const slots = program.slots?.length
    ? program.slots
    : program.onTime || program.offTime
      ? [{ onTime: program.onTime, offTime: program.offTime }]
      : [];
  return slots.filter((slot) => !slot.weekdays?.length || slot.weekdays.includes(weekday));
}

function programSpans(groups: Array<{ offset: number; slots: Array<{ onTime: string | null; offTime: string | null }> }>) {
  const events: Array<{ at: number; on: boolean }> = [];
  for (const group of groups) {
    for (const slot of group.slots) {
      const on = minutes(slot.onTime);
      const off = minutes(slot.offTime);
      if (on != null) events.push({ at: group.offset + on, on: true });
      if (off != null) events.push({ at: group.offset + off + (on != null && off <= on ? 1440 : 0), on: false });
    }
  }
  events.sort((left, right) => left.at - right.at || Number(left.on) - Number(right.on));
  const offOnly = events.every((event) => !event.on);
  const spans: Array<[number, number]> = [];
  let since: number | null = null;
  events.forEach((event, index) => {
    if (event.on) {
      since ??= event.at;
    } else if (since != null) {
      spans.push([since, event.at]);
      since = null;
    } else if (offOnly || index === 0) {
      spans.push([index > 0 ? events[index - 1].at : -Infinity, event.at]);
    }
  });
  if (since != null) spans.push([since, 1440]);
  return spans
    .map(([start, end]): [number, number] => [Math.max(0, start), Math.min(1440, end)])
    .filter(([start, end]) => end > start);
}

export function laneBars(bars: DayBar[]): Array<DayBar & { lane: number }> {
  const grouped = new Map<string, DayBar[]>();
  for (const bar of bars) {
    const list = grouped.get(bar.deviceId) ?? [];
    list.push(bar);
    grouped.set(bar.deviceId, list);
  }
  const placed: Array<DayBar & { lane: number }> = [];
  for (const list of grouped.values()) {
    const sorted = [...list].sort((left, right) => left.start - right.start || left.end - right.end);
    const ends: number[] = [];
    for (const bar of sorted) {
      let lane = ends.findIndex((end) => end <= bar.start);
      if (lane < 0) {
        lane = ends.length;
        ends.push(bar.end);
      } else {
        ends[lane] = bar.end;
      }
      placed.push({ ...bar, lane });
    }
  }
  return placed;
}
