"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { CalendarClock, ChevronDown, Clock, Repeat, SunMedium, Timer } from "lucide-react";
import { DeviceGlyph } from "@/components/device-glyph";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatClockActions, resolveActions, type ClockAction } from "@/lib/programs/actions";
import type { OccurrenceClock, OccurrenceProgram } from "@/lib/programs/occurrences";
import { maxDayClocks, maxProgramDays, maxSlots, slotsForWeekday } from "@/lib/programs/slots";
import { coversDay } from "@/lib/programs/span";
import { WEEKDAY_LABELS, cleanWeekdays, sharedClockDays, weekdayOf, weekdayPhrase, weeklyClockDays } from "@/lib/programs/weekdays";
import { israelDate, shiftDate } from "@/lib/time";
import { cn } from "cn";

const PREFS_KEY = "ksh-plan-prefs";
const SUN_LABELS = {
  sunrise: "זריחה",
  sunset: "שקיעה",
  "shabbat-in": "כניסת שבת",
  "shabbat-out": "צאת שבת",
} as const;

export type PlannerDevice = { deviceId: string; name: string; icon: string | null };
export type PlannerPlace = { id: string; name: string };
export type PlannerProgram = OccurrenceProgram & { days: string[] };
export type PlannerClock = OccurrenceClock;

export type PlannerDraft = {
  token: number;
  mode: "new" | "program" | "clock";
  date: string;
  program: PlannerProgram | null;
  clock: PlannerClock | null;
  clocks: PlannerClock[];
  devices: PlannerDevice[];
  places: PlannerPlace[];
  locationId: string;
};

type Frequency = "once" | "weekly" | "daily";
type ScheduleKind = "times" | "duration" | "sun";
type Step = {
  key: number;
  action: "on" | "off";
  time: string;
  nextDay: boolean;
};

type Range = {
  key: number;
  steps: Step[];
  date: string;
  clockId: string | null;
  originalDate: string | null;
  weekdays?: number[];
  deviceIds: string[];
};

type FormState = {
  programId: string | null;
  looseClockId: string | null;
  hadWeekdays: boolean;
  scheduleDirty: boolean;
  name: string;
  frequency: Frequency;
  weekdays: number[];
  startDate: string;
  endDate: string;
  schedule: ScheduleKind;
  ranges: Range[];
  durationStart: string;
  durationMinutes: string;
  sunEvent: keyof typeof SUN_LABELS;
  sunOffset: string;
  city: string;
  sunAction: "on" | "off";
  deviceIds: string[];
  enabled: boolean;
  notify: boolean;
  conflict: boolean;
  skip: boolean;
  skipHolidays: boolean;
};

const control =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

let rangeSeq = 1;

function rangeId() {
  rangeSeq += 1;
  return rangeSeq;
}

function readPrefs(id: string | null) {
  const fallback = { notify: false, conflict: true, skip: false };
  if (!id || typeof window === "undefined") return fallback;
  try {
    const all = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}") as Record<string, { notify?: boolean; conflict?: boolean; skip?: boolean }>;
    const row = all[id];
    if (!row) return fallback;
    return { notify: Boolean(row.notify), conflict: row.conflict !== false, skip: Boolean(row.skip) };
  } catch {
    return fallback;
  }
}

export function writePlanPrefs(id: string, prefs: { notify: boolean; conflict: boolean; skip: boolean }) {
  try {
    const all = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}") as Record<string, unknown>;
    all[id] = prefs;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(all));
  } catch {
    // The plan itself is already stored on the account.
  }
}

function knownIds(ids: string[], devices: PlannerDevice[]) {
  const allowed = new Set(devices.map((device) => device.deviceId));
  return ids.filter((id) => allowed.has(id));
}

function clockRange(
  on: string,
  off: string,
  date: string,
  clockId: string | null = null,
  originalDate: string | null = null,
  weekdays?: number[],
  deviceIds: string[] = [],
  actions?: ClockAction[],
) {
  return { key: rangeId(), steps: stepsFrom(on, off, actions), date, clockId, originalDate, weekdays, deviceIds: [...deviceIds] };
}

function stepsFrom(on: string, off: string, actions?: ClockAction[]): Step[] {
  const source = actions?.length ? actions : resolveActions({ onTime: on || null, offTime: off || null });
  if (!source.length) return [{ key: rangeId(), action: "on", time: "", nextDay: false }];
  return source.map((step) => ({
    key: rangeId(),
    action: step.action === "OFF" ? "off" : "on",
    time: step.time,
    nextDay: Boolean(step.nextDay),
  }));
}

function filledSteps(range: Range) {
  return range.steps.filter((step) => /^\d{2}:\d{2}$/.test(step.time));
}

function savedActions(range: Range): ClockAction[] {
  return filledSteps(range).map((step) => ({
    action: step.action === "off" ? "OFF" : "ON",
    time: step.time,
    ...(step.nextDay ? { nextDay: true } : {}),
  }));
}

function isIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateForWeekday(weekday: number, from: string) {
  let day = isIso(from) ? from : israelDate();
  for (let index = 0; index < 7; index += 1) {
    if (weekdayOf(day) === weekday) return day;
    day = shiftDate(day, 1);
  }
  return day;
}

function applyWeekdays(ranges: Range[], weekdays: number[], startDate: string): Range[] {
  const days = cleanWeekdays(weekdays);
  const origin = isIso(startDate) ? startDate : israelDate();
  const anchor = days.length ? dateForWeekday(days[0], origin) : origin;
  return ranges.map((range) => {
    const current = isIso(range.date) ? weekdayOf(range.date) : null;
    const date =
      current != null && days.includes(current)
        ? range.date
        : days.length
          ? dateForWeekday(days[0], isIso(range.date) ? range.date : origin)
          : range.date || anchor;
    return { ...range, weekdays: days, date };
  });
}

function clockRepeatLabel(days: number[]) {
  if (days.length === 1 && days[0] === 6) return "יחזור כל שבוע בשבת";
  if (days.length === 1) return `יחזור כל שבוע ביום ${WEEKDAY_LABELS[days[0]]}`;
  return `יחזור כל שבוע ${weekdayPhrase(days) || "בימים שסומנו למעלה"}`;
}

function rangesFromProgram(draft: PlannerDraft, program: PlannerProgram): Range[] {
  const origin = program.startDate || draft.date;
  const fallback = knownIds(program.deviceIds, draft.devices);
  if (program.weekdays.length === 7) {
    const rows = program.slots
      .filter((slot) => slot.onTime || slot.offTime || slot.actions?.length)
      .map((slot) =>
        clockRange(slot.onTime ?? "", slot.offTime ?? "", origin, null, null, undefined, knownIds(slot.deviceIds?.length ? slot.deviceIds : fallback, draft.devices), slot.actions),
      );
    return rows.length ? rows : [clockRange("08:00", "09:00", origin, null, null, undefined, fallback)];
  }
  if (program.weekdays.length) {
    const rows = program.slots
      .filter((slot) => slot.onTime || slot.offTime || slot.actions?.length)
      .map((slot) => {
        const stored = slot.date && isIso(slot.date) ? slot.date : "";
        const days = cleanWeekdays(slot.weekdays?.length ? slot.weekdays : program.weekdays);
        const date = stored || dateForWeekday(days[0] ?? weekdayOf(origin), origin);
        const own = stored ? [weekdayOf(stored)] : days;
        return clockRange(
          slot.onTime ?? "",
          slot.offTime ?? "",
          date,
          null,
          null,
          own,
          knownIds(slot.deviceIds?.length ? slot.deviceIds : fallback, draft.devices),
          slot.actions,
        );
      });
    return rows.length ? rows : [clockRange("", "", origin, null, null, program.weekdays, fallback)];
  }
  const owned = draft.clocks.filter((clock) => !clock.recurring && clock.programId === program.id);
  const rows = owned.map((clock) =>
    clockRange(
      clock.onTime ?? "",
      clock.offTime ?? "",
      clock.day,
      clock.id,
      clock.day,
      undefined,
      knownIds(clock.deviceIds.length ? clock.deviceIds : fallback, draft.devices),
      clock.actions,
    ),
  );
  return rows.length ? rows : [clockRange("", "", draft.date, null, null, undefined, fallback)];
}

function buildForm(draft: PlannerDraft): FormState {
  const city = draft.places.some((place) => place.id === draft.locationId) ? draft.locationId : (draft.places[0]?.id ?? "");
  const base: FormState = {
    programId: null,
    looseClockId: null,
    hadWeekdays: false,
    scheduleDirty: false,
    name: "",
    frequency: "once",
    weekdays: [weekdayOf(draft.date)],
    startDate: draft.date,
    endDate: "",
    schedule: "times",
    ranges: [clockRange("08:00", "09:00", draft.date, null, null, undefined, draft.devices.length === 1 ? [draft.devices[0].deviceId] : [])],
    durationStart: "08:00",
    durationMinutes: "45",
    sunEvent: "sunset",
    sunOffset: "-20",
    city,
    sunAction: "on",
    deviceIds: draft.devices.length === 1 ? [draft.devices[0].deviceId] : [],
    enabled: true,
    skipHolidays: false,
    ...readPrefs(null),
  };
  if (draft.mode === "clock" && draft.clock) {
    return {
      ...base,
      looseClockId: draft.clock.id,
      startDate: draft.clock.day,
      ranges: [
        clockRange(
          draft.clock.onTime ?? "",
          draft.clock.offTime ?? "",
          draft.clock.day,
          null,
          null,
          undefined,
          knownIds(draft.clock.deviceIds, draft.devices),
          draft.clock.actions,
        ),
      ],
      deviceIds: knownIds(draft.clock.deviceIds, draft.devices),
    };
  }
  const program = draft.program;
  if (draft.mode !== "program" || !program) return base;
  const weekly = program.weekdays.length > 0;
  const frequency: Frequency = program.weekdays.length === 7 ? "daily" : weekly ? "weekly" : "once";
  const weekdays =
    frequency === "weekly"
      ? cleanWeekdays(program.weekdays)
      : frequency === "daily"
        ? [0, 1, 2, 3, 4, 5, 6]
        : [weekdayOf(program.startDate ?? draft.date)];
  return {
    ...base,
    programId: program.id,
    hadWeekdays: weekly,
    name: program.name,
    frequency,
    weekdays,
    startDate: weekly ? (program.startDate ?? draft.date) : draft.date,
    endDate: weekly ? (program.endDate ?? "") : "",
    ranges: rangesFromProgram(draft, program),
    deviceIds: knownIds(program.deviceIds, draft.devices),
    enabled: program.enabled,
    skipHolidays: Boolean(program.skipHolidays),
    ...readPrefs(program.id),
  };
}

function clockShift(time: string, minutes: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !Number.isFinite(minutes)) return { time: "", nextDay: false };
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  return {
    time: `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`,
    nextDay: total >= 1440,
  };
}

function activeRanges(form: FormState): Range[] {
  if (form.schedule === "duration") {
    const shifted = clockShift(form.durationStart, Number(form.durationMinutes));
    return [
      {
        key: 0,
        steps: stepsFrom(form.durationStart, shifted.nextDay ? "" : shifted.time).concat(
          shifted.nextDay && shifted.time ? [{ key: 0, action: "off", time: shifted.time, nextDay: true }] : [],
        ),
        date: form.startDate,
        clockId: null,
        originalDate: null,
        deviceIds: [...form.deviceIds],
      },
    ];
  }
  return form.ranges.map((range) => ({
    ...range,
    steps: range.steps.map((step) => ({ ...step })),
    deviceIds: [...range.deviceIds],
  }));
}

function earliestDate(dates: string[], fallback: string) {
  const valid = dates.filter(isIso).sort();
  return valid[0] || fallback;
}

function seriesStart(form: FormState, dates: string[]) {
  if (form.frequency === "daily") return form.startDate || earliestDate(dates, "");
  if (form.frequency === "weekly") return earliestDate(dates, form.startDate);
  return form.startDate;
}

function summaryText(form: FormState, places: PlannerPlace[]) {
  const name = form.name.trim() || "תוכנית ללא שם";
  const start = seriesStart(
    form,
    form.ranges.map((range) => range.date),
  );
  const until = form.frequency !== "once" && form.endDate ? ` עד ${form.endDate}` : "";
  const when =
    form.frequency === "once"
      ? "חד־פעמית לפי תאריך כל שעון"
      : form.frequency === "daily"
        ? `מ־${start || "תאריך שלא נבחר"} · כל יום${until}`
        : `מ־${start || "תאריך שלא נבחר"} · כל שבוע ${weekdayPhrase(form.weekdays) || "בלי ימים"}${until}`;
  const city = places.find((place) => place.id === form.city)?.name ?? "";
  const how =
    form.schedule === "times"
      ? form.ranges
          .map((range) => {
            const label = formatClockActions({ actions: savedActions(range) }) || "--:--";
            return form.frequency === "once" ? `${label} (${range.date || "תאריך חסר"})` : label;
          })
          .join(" | ")
      : form.schedule === "duration"
        ? `הדלקה ב־${form.durationStart || "--:--"} למשך ${form.durationMinutes || 0} דקות`
        : `${SUN_LABELS[form.sunEvent]} (${form.sunOffset || "0"} דקות)${city ? `, ${city}` : ""}`;
  const deviceCount =
    form.schedule === "times" ? new Set(form.ranges.flatMap((range) => range.deviceIds)).size : form.deviceIds.length;
  const holidays = form.skipHolidays ? " · בלי הפעלה בחגים" : "";
  return `${name} · ${when} · ${how} · ${deviceCount} התקנים${holidays}`;
}

function durationText(form: FormState) {
  const minutes = Number(form.durationMinutes);
  if (!/^\d{2}:\d{2}$/.test(form.durationStart) || !Number.isFinite(minutes)) return "המכשיר יכבה אוטומטית בסיום הזמן.";
  const shifted = clockShift(form.durationStart, minutes);
  if (!shifted.time) return "המכשיר יכבה אוטומטית בסיום הזמן.";
  return `כיבוי צפוי בשעה ${shifted.time}${shifted.nextDay ? " (למחרת)" : ""}`;
}

function validate(form: FormState) {
  if (!form.name.trim()) return "יש להזין שם לתוכנית";
  if (!form.startDate) return "יש לבחור תאריך התחלה";
  if (form.schedule === "times") {
    if (form.ranges.some((range) => !range.deviceIds.length)) return "יש לבחור לפחות שקע אחד לכל שעון";
  } else if (!form.deviceIds.length) {
    return "יש לבחור לפחות שקע אחד";
  }
  if (form.frequency === "weekly" && !cleanWeekdays(form.weekdays).length) return "יש לסמן לפחות יום אחד בשבוע";
  if (form.schedule === "times") {
    if (form.ranges.length > maxSlots) return `אפשר עד ${maxSlots} שעונים בתוכנית`;
    if (form.ranges.some((range) => range.steps.length > 8)) return "אפשר עד 8 פעולות בשעון";
    if (form.ranges.some((range) => range.steps.some((step) => !/^\d{2}:\d{2}$/.test(step.time)))) return "מלאו שעה לכל פעולה, או הסירו את השורה הריקה";
    if (form.ranges.some((range) => !filledSteps(range).length)) return "לכל שעון צריכה להיות לפחות פעולה אחת";
    if (form.ranges.some((range) => !isIso(range.date))) return "יש לבחור תאריך לכל שעון";
    const perDay = new Map<string, number>();
    for (const range of form.ranges) perDay.set(range.date, (perDay.get(range.date) ?? 0) + 1);
    if ([...perDay.values()].some((count) => count > maxDayClocks)) return `אפשר עד ${maxDayClocks} שעונים ביום`;
    if (form.frequency === "once" && perDay.size > maxProgramDays) return `אפשר עד ${maxProgramDays} ימים בתוכנית`;
  }
  const start = seriesStart(
    form,
    form.ranges.map((range) => range.date),
  );
  if (form.frequency !== "once" && form.endDate && start && form.endDate < start) return "תאריך הסיום מוקדם מתאריך ההתחלה";
  if (form.schedule === "duration") {
    const minutes = Number(form.durationMinutes);
    if (!/^\d{2}:\d{2}$/.test(form.durationStart) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return "יש להזין זמן הפעלה תקין בין 1 ל־1440 דקות";
    }
  }
  if (form.schedule === "sun") return "תזמון לפי זמני היום אינו זמין לשמירה כהפעלה אמיתית ללא חיבור לשירות זמני היום";
  return null;
}

function minutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function intervals(today: Step[][], previous: Step[][]) {
  const out: Array<[number, number]> = [];
  for (const steps of today) out.push(...marksOn(steps, false));
  for (const steps of previous) out.push(...marksOn(steps, true));
  return out;
}

function marksOn(steps: Step[], previousDay: boolean): Array<[number, number]> {
  const filled = steps.filter((step) => minutes(step.time) != null);
  const out: Array<[number, number]> = [];
  if (previousDay) {
    for (const step of filled) {
      if (!step.nextDay) continue;
      const at = minutes(step.time);
      if (at != null) out.push([0, at]);
    }
    return out;
  }
  for (const step of filled) {
    if (step.nextDay) continue;
    const at = minutes(step.time);
    if (at != null) out.push([at, at + 1]);
  }
  for (const on of filled.filter((step) => step.action === "on" && !step.nextDay)) {
    const start = minutes(on.time);
    if (start == null) continue;
    const later = filled
      .filter((step) => step.action === "off")
      .map((step) => ({ at: minutes(step.time), nextDay: step.nextDay }))
      .filter((step): step is { at: number; nextDay: boolean } => step.at != null && (step.nextDay || step.at > start))
      .sort((left, right) => Number(left.nextDay) - Number(right.nextDay) || left.at - right.at)[0];
    if (!later) continue;
    out.push(later.nextDay ? [start, 1440] : [start, later.at]);
  }
  return out;
}

function overlaps(left: [number, number], right: [number, number]) {
  return left[0] < right[1] && right[0] < left[1];
}

function draftRanges(form: FormState, day: string) {
  const chosen = activeRanges(form).filter((range) => filledSteps(range).length && isIso(range.date));
  if (form.frequency === "once") return chosen.filter((range) => range.date === day).map((range) => range.steps);
  const start = seriesStart(
    form,
    chosen.map((range) => range.date),
  );
  if (!coversDay(day, start || null, form.endDate || null)) return [];
  if (form.frequency === "daily") return chosen.map((range) => range.steps);
  const days = cleanWeekdays(form.weekdays);
  const weekday = weekdayOf(day);
  if (!days.includes(weekday)) return [];
  const owned = weeklyClockDays(
    chosen.map((range) => range.date),
    days,
  );
  return chosen.filter((_, index) => (owned[index] ?? days).includes(weekday)).map((range) => range.steps);
}

function storedRanges(program: PlannerProgram, clocks: PlannerClock[], day: string): Step[][] {
  if (!program.enabled || (program.skippedDates ?? []).includes(day)) return [];
  if (program.weekdays.length) {
    if (!program.weekdays.includes(weekdayOf(day)) || !coversDay(day, program.startDate, program.endDate)) return [];
    return slotsForWeekday(sharedClockDays(program.slots, program.weekdays), weekdayOf(day)).map((slot) => stepsFrom(slot.onTime ?? "", slot.offTime ?? "", slot.actions));
  }
  return clocks
    .filter((clock) => !clock.recurring && clock.programId === program.id && clock.day === day)
    .map((clock) => stepsFrom(clock.onTime ?? "", clock.offTime ?? "", clock.actions));
}

function conflictName(form: FormState, programs: PlannerProgram[], clocks: PlannerClock[]) {
  if (!form.conflict || !form.enabled || form.schedule === "sun") return null;
  const days = new Set<string>();
  const today = israelDate();
  for (let index = 0; index < 84; index += 1) days.add(shiftDate(today, index));
  if (form.startDate) days.add(form.startDate);
  for (const range of form.ranges) if (isIso(range.date)) days.add(range.date);
  for (const day of days) {
    const previous = shiftDate(day, -1);
    const mine = intervals(draftRanges(form, day), draftRanges(form, previous));
    if (!mine.length) continue;
    const myDevices =
      form.schedule === "times"
        ? [...new Set(form.ranges.flatMap((range) => range.deviceIds))]
        : form.deviceIds;
    for (const program of programs) {
      if (program.id === form.programId || !program.enabled || !myDevices.some((id) => program.deviceIds.includes(id))) continue;
      const theirs = intervals(storedRanges(program, clocks, day), storedRanges(program, clocks, previous));
      if (mine.some((left) => theirs.some((right) => overlaps(left, right)))) return program.name;
    }
    for (const clock of clocks) {
      if (clock.recurring || clock.programId || clock.id === form.looseClockId) continue;
      if (!myDevices.some((id) => clock.deviceIds.includes(id))) continue;
      const row = stepsFrom(clock.onTime ?? "", clock.offTime ?? "", clock.actions);
      const theirs = intervals(clock.day === day ? [row] : [], clock.day === previous ? [row] : []);
      if (mine.some((left) => theirs.some((right) => overlaps(left, right)))) return "שעון";
    }
  }
  return null;
}

function buildBody(form: FormState) {
  const ranges = activeRanges(form).filter((range) => filledSteps(range).length);
  if (form.frequency === "once") {
    const grouped = new Map<string, Array<{ id: string; onTime: string | null; offTime: string | null; actions: ClockAction[]; deviceIds: string[] }>>();
    for (const range of ranges) {
      const clocks = grouped.get(range.date) ?? [];
      const actions = savedActions(range);
      const onTime = actions.find((step) => step.action === "ON")?.time ?? null;
      const offTime = actions.find((step) => step.action === "OFF")?.time ?? null;
      clocks.push({
        id: range.clockId && range.date === range.originalDate ? range.clockId : "",
        onTime,
        offTime,
        actions,
        deviceIds: range.deviceIds,
      });
      grouped.set(range.date, clocks);
    }
    const deviceIds = [...new Set(ranges.flatMap((range) => range.deviceIds))];
    return {
      action: "program-save",
      id: form.programId,
      name: form.name.trim(),
      deviceIds,
      enabled: form.enabled,
      skipHolidays: form.skipHolidays,
      replaceClockId: form.looseClockId,
      days: [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, clocks]) => ({ date, clocks })),
    };
  }
  const seen = new Set<string>();
  const markedDays = cleanWeekdays(form.weekdays);
  const ownedDays = weeklyClockDays(
    ranges.map((range) => range.date),
    markedDays,
  );
  const slots = ranges.flatMap((range, index) => {
    const actions = savedActions(range);
    const onTime = actions.find((step) => step.action === "ON")?.time ?? null;
    const offTime = actions.find((step) => step.action === "OFF")?.time ?? null;
    if (form.frequency === "daily") {
      const key = `${actions.map((step) => `${step.action}${step.nextDay ? "+" : ""}${step.time}`).join(",")}|${range.deviceIds.join(",")}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ onTime, offTime, actions, weekdays: [] as number[], deviceIds: range.deviceIds }];
    }
    return [{
      onTime,
      offTime,
      actions,
      weekdays: ownedDays[index] ?? markedDays,
      ...(isIso(range.date) ? { date: range.date } : {}),
      deviceIds: range.deviceIds,
    }];
  });
  const weekdays = form.frequency === "daily" ? [0, 1, 2, 3, 4, 5, 6] : cleanWeekdays(form.weekdays);
  const deviceIds = [...new Set(ranges.flatMap((range) => range.deviceIds))];
  return {
    action: "repeat-save",
    id: form.programId,
    name: form.name.trim(),
    weekdays,
    slots,
    deviceIds,
    enabled: form.enabled,
    skipHolidays: form.skipHolidays,
    startDate: seriesStart(
      form,
      ranges.map((range) => range.date),
    ),
    endDate: form.endDate || null,
    replaceClockId: form.looseClockId,
  };
}

export function PlanDialog({
  draft,
  programs,
  clocks,
  pending,
  serverError,
  onClose,
  onSave,
  onDelete,
}: {
  draft: PlannerDraft;
  programs: PlannerProgram[];
  clocks: PlannerClock[];
  pending: boolean;
  serverError: string | null;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<{ id: string | null } | null>;
  onDelete: () => void;
}) {
  const [form, setForm] = useState(() => buildForm(draft));
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(() => !form.enabled || form.notify || form.skip || !form.conflict);
  const shownError = error || serverError;

  function patch(recipe: (current: FormState) => FormState, dirty = false) {
    setError(null);
    setForm((current) => {
      const next = recipe(current);
      return dirty ? { ...next, scheduleDirty: true } : next;
    });
  }

  function reset() {
    if (!window.confirm("לנקות את הטופס?")) return;
    setForm(buildForm(draft));
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    if (form.hadWeekdays && form.frequency === "once" && !window.confirm("החזרה השבועית תוחלף בתאריכי השעונים שבחרת. להמשיך?")) return;
    if (form.programId && !form.hadWeekdays && form.frequency !== "once" && !window.confirm("התוכנית החד־פעמית תהפוך לחזרה לפי ימי השעונים. להמשיך?")) return;
    const other = conflictName(form, programs, clocks);
    if (other && !window.confirm(`יש התנגשות עם «${other}» על אותו שקע. לשמור בכל זאת?`)) return;
    const saved = await onSave(buildBody(form));
    if (!saved) return;
    if (saved.id) writePlanPrefs(saved.id, { notify: form.notify, conflict: form.conflict, skip: form.skip });
    onClose();
  }

  const editing = Boolean(form.programId || form.looseClockId);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        data-plan-dialog
        showCloseButton={false}
        className="flex max-h-[min(94dvh,980px)] w-[min(1080px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[1080px] max-sm:!inset-0 max-sm:!h-dvh max-sm:!max-h-dvh max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none"
        style={{ width: "min(1080px, calc(100vw - 2rem))" }}
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
          <div className="flex items-start justify-between gap-3 border-b px-5 py-5 sm:px-8">
            <div>
              <DialogTitle className="text-[22px] font-semibold tracking-tight sm:text-[25px]">
                {editing ? "עריכת תוכנית" : "תוכנית חדשה"}
              </DialogTitle>
              <DialogDescription className="mt-1">מגדירים פעם אחת, והמערכת דואגת לתזמון.</DialogDescription>
            </div>
            <button
              type="button"
              className="grid size-9 shrink-0 place-items-center rounded-xl border text-xl text-muted-foreground"
              aria-label="סגירה"
              disabled={pending}
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-10 sm:py-8">
            <section className="mb-8">
              <SectionTitle n="01">פרטי התוכנית</SectionTitle>
              <label className="mb-2 block text-xs font-bold" htmlFor="plan-name">
                שם התוכנית
              </label>
              <input
                id="plan-name"
                className={control}
                maxLength={80}
                placeholder="לדוגמה: הדלקת המזגן בערב"
                value={form.name}
                autoFocus
                onChange={(event) => patch((current) => ({ ...current, name: event.target.value }))}
              />
            </section>
            <section className="mb-8">
              <SectionTitle n="02">מתי התוכנית תפעל?</SectionTitle>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Choice
                  active={form.frequency === "once"}
                  icon={<CalendarClock className="mx-auto size-5" />}
                  title="חד־פעמי"
                  detail="תאריך מסוים"
                  onClick={() => patch((current) => (current.frequency === "once" ? current : { ...current, frequency: "once", scheduleDirty: true }))}
                />
                <Choice
                  active={form.frequency === "weekly"}
                  icon={<Repeat className="mx-auto size-5" />}
                  title="חזרה שבועית"
                  detail="סימון ימי פעולה"
                  onClick={() =>
                    patch((current) => {
                      if (current.frequency === "weekly") return current;
                      const weekdays = cleanWeekdays(current.weekdays).length
                        ? cleanWeekdays(current.weekdays)
                        : [weekdayOf(current.startDate || israelDate())];
                      return {
                        ...current,
                        frequency: "weekly",
                        weekdays,
                        ranges: applyWeekdays(current.ranges, weekdays, current.startDate),
                        scheduleDirty: true,
                      };
                    })
                  }
                />
                <Choice
                  active={form.frequency === "daily"}
                  icon={<SunMedium className="mx-auto size-5" />}
                  title="כל יום"
                  detail="חזרה יומית"
                  onClick={() => patch((current) => (current.frequency === "daily" ? current : { ...current, frequency: "daily", scheduleDirty: true }))}
                />
              </div>
              <div className="mt-3 rounded-2xl border bg-muted/30 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-bold">
                    תאריך ברירת מחדל לשעון חדש
                    <input
                      className={cn(control, "mt-2")}
                      dir="ltr"
                      type="date"
                      value={form.startDate}
                      onChange={(event) => patch((current) => ({ ...current, startDate: event.target.value }))}
                    />
                  </label>
                  {form.frequency === "once" ? null : (
                    <label className="block text-xs font-bold">
                      תאריך סיום (לא חובה)
                      <input
                        className={cn(control, "mt-2")}
                        dir="ltr"
                        type="date"
                        value={form.endDate}
                        onChange={(event) => patch((current) => ({ ...current, endDate: event.target.value }))}
                      />
                    </label>
                  )}
                </div>
                {form.frequency === "weekly" ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-bold">ימים לפעולה</p>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAY_LABELS.map((label, day) => {
                        const active = form.weekdays.includes(day);
                        return (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={active}
                            className={cn(
                              "min-w-10 rounded-xl border px-3 py-2 text-sm font-bold",
                              active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground",
                            )}
                            onClick={() =>
                              patch((current) => {
                                const weekdays = cleanWeekdays(
                                  active ? current.weekdays.filter((item) => item !== day) : [...current.weekdays, day],
                                );
                                return {
                                  ...current,
                                  weekdays,
                                  ranges: applyWeekdays(current.ranges, weekdays, current.startDate),
                                  scheduleDirty: true,
                                };
                              })
                            }
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                      {weekdayPhrase(form.weekdays) || "סמנו לפחות יום אחד"}
                    </p>
                  </div>
                ) : null}
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border bg-card p-4">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={form.skipHolidays}
                  onChange={(event) => patch((current) => ({ ...current, skipHolidays: event.target.checked }))}
                />
                <span>
                  <b className="block text-sm">מנע הפעלה בחגים</b>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    בימי החג התוכנית לא תדליק ולא תכבה. לא כולל חנוכה ופורים, שהם ימי חול.
                  </span>
                </span>
              </label>
            </section>
            <section className="mb-8">
              <SectionTitle n="03">איך ההתקנים יפעלו?</SectionTitle>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Choice
                  active={form.schedule === "times"}
                  icon={<Clock className="mx-auto size-5" />}
                  title="שעות קבועות"
                  detail="הדלקה, כיבוי, או שניהם"
                  onClick={() => patch((current) => (current.schedule === "times" ? current : { ...current, schedule: "times" }), true)}
                />
                <Choice
                  active={form.schedule === "duration"}
                  icon={<Timer className="mx-auto size-5" />}
                  title="משך הפעלה"
                  detail="כיבוי אוטומטי"
                  onClick={() => patch((current) => (current.schedule === "duration" ? current : { ...current, schedule: "duration" }), true)}
                />
                <Choice
                  active={form.schedule === "sun"}
                  icon={<SunMedium className="mx-auto size-5" />}
                  title="זמני היום"
                  detail="שבת ושקיעה"
                  onClick={() => patch((current) => ({ ...current, schedule: "sun" }))}
                />
              </div>
              {form.schedule === "times" ? (
                <div className="mt-3 rounded-2xl border bg-muted/30 p-4">
                  <div className="space-y-2">
                    {form.ranges.map((range, index) => (
                      <div key={range.key} className="rounded-xl border bg-card p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <b className="text-xs">שעון {index + 1}</b>
                          <button
                            type="button"
                            className="rounded-lg bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive"
                            onClick={() => {
                              if (form.ranges.length === 1) {
                                setError("יש להשאיר לפחות שעון אחד");
                                return;
                              }
                              patch((current) => ({ ...current, ranges: current.ranges.filter((item) => item.key !== range.key) }), true);
                            }}
                          >
                            הסרה ×
                          </button>
                        </div>
                        {form.frequency === "daily" ? (
                          <p className="mb-3 text-[11px] font-medium text-muted-foreground">מ־{form.startDate || "התאריך למעלה"} · כל יום</p>
                        ) : (
                          <label className="mb-3 block text-xs font-bold">
                            {form.frequency === "weekly" ? "תאריך הפעלה ראשון" : "תאריך השעון — לחיצה פותחת לוח שנה"}
                            <input
                              className={cn(control, "mt-2")}
                              dir="ltr"
                              type="date"
                              required
                              value={range.date}
                              aria-label={`תאריך, שעון ${index + 1}`}
                              onChange={(event) =>
                                patch((current) => {
                                  const date = event.target.value;
                                  const ranges = current.ranges.map((item) => {
                                    if (item.key !== range.key) return item;
                                    if (current.frequency === "weekly") return { ...item, date };
                                    const keep = item.weekdays && item.weekdays.length > 1;
                                    return {
                                      ...item,
                                      date,
                                      weekdays: keep ? item.weekdays : isIso(date) ? [weekdayOf(date)] : item.weekdays,
                                    };
                                  });
                                  if (current.frequency !== "weekly" || !isIso(date)) return { ...current, ranges };
                                  const day = weekdayOf(date);
                                  const weekdays = current.weekdays.includes(day) ? current.weekdays : cleanWeekdays([...current.weekdays, day]);
                                  return { ...current, ranges, weekdays };
                                }, true)
                              }
                            />
                            <span className="mt-1 block text-[11px] font-medium text-muted-foreground">
                              {form.frequency === "weekly"
                                ? clockRepeatLabel(
                                    weeklyClockDays(
                                      form.ranges.map((item) => item.date),
                                      form.weekdays,
                                    )[index] ?? [],
                                  )
                                : "אפשר לבחור תאריך אחר לכל שעון באותה תוכנית."}
                            </span>
                          </label>
                        )}
                        <div className="space-y-2">
                          {range.steps.map((step, stepIndex) => (
                            <div key={step.key} className="grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto]">
                              <select
                                className={cn(control, "min-w-0")}
                                value={step.action}
                                aria-label={`פעולה ${stepIndex + 1}, שעון ${index + 1}`}
                                onChange={(event) => {
                                  const action = event.target.value === "off" ? "off" : "on";
                                  patch(
                                    (current) => ({
                                      ...current,
                                      ranges: current.ranges.map((item) =>
                                        item.key === range.key
                                          ? {
                                              ...item,
                                              steps: item.steps.map((row) => (row.key === step.key ? { ...row, action } : row)),
                                            }
                                          : item,
                                      ),
                                    }),
                                    true,
                                  );
                                }}
                              >
                                <option value="on">הדלקה</option>
                                <option value="off">כיבוי</option>
                              </select>
                              <input
                                className={cn(control, "min-w-0 text-base tabular-nums sm:text-sm")}
                                dir="ltr"
                                type="time"
                                value={step.time}
                                aria-label={`שעה ${stepIndex + 1}, שעון ${index + 1}`}
                                onChange={(event) =>
                                  patch(
                                    (current) => ({
                                      ...current,
                                      ranges: current.ranges.map((item) =>
                                        item.key === range.key
                                          ? {
                                              ...item,
                                              steps: item.steps.map((row) => (row.key === step.key ? { ...row, time: event.target.value } : row)),
                                            }
                                          : item,
                                      ),
                                    }),
                                    true,
                                  )
                                }
                              />
                              <button
                                type="button"
                                className="h-10 w-fit justify-self-start rounded-xl border px-3 text-xs font-bold text-muted-foreground disabled:opacity-30"
                                disabled={range.steps.length === 1}
                                aria-label={`הסרת פעולה ${stepIndex + 1}, שעון ${index + 1}`}
                                onClick={() =>
                                  patch(
                                    (current) => ({
                                      ...current,
                                      ranges: current.ranges.map((item) =>
                                        item.key === range.key ? { ...item, steps: item.steps.filter((row) => row.key !== step.key) } : item,
                                      ),
                                    }),
                                    true,
                                  )
                                }
                              >
                                הסרה
                              </button>
                            </div>
                          ))}
                          {range.steps.length < 8 ? (
                            <button
                              type="button"
                              className="text-xs font-bold text-primary"
                              onClick={() =>
                                patch((current) => ({
                                  ...current,
                                  ranges: current.ranges.map((item) => {
                                    if (item.key !== range.key) return item;
                                    const last = item.steps.at(-1);
                                    const action = last?.action === "on" ? "off" : "on";
                                    return { ...item, steps: [...item.steps, { key: rangeId(), action, time: "", nextDay: false }] };
                                  }),
                                }))
                              }
                            >
                              הוספת פעולה
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-4 border-t border-border/70 pt-4">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-xs font-bold">על אילו התקנים?</p>
                            {draft.devices.length > 1 ? (
                              <button
                                type="button"
                                className="text-[11px] font-bold text-primary"
                                onClick={() =>
                                  patch((current) => ({
                                    ...current,
                                    ranges: current.ranges.map((item) =>
                                      item.key === range.key
                                        ? {
                                            ...item,
                                            deviceIds:
                                              item.deviceIds.length === draft.devices.length
                                                ? []
                                                : draft.devices.map((device) => device.deviceId),
                                          }
                                        : item,
                                    ),
                                  }))
                                }
                              >
                                {range.deviceIds.length === draft.devices.length ? "ניקוי בחירה" : "בחירת הכול"}
                              </button>
                            ) : null}
                          </div>
                          {draft.devices.length ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {draft.devices.map((device) => {
                                const checked = range.deviceIds.includes(device.deviceId);
                                return (
                                  <label
                                    key={device.deviceId}
                                    className={cn(
                                      "flex cursor-pointer items-center gap-2 rounded-xl border p-3",
                                      checked ? "border-primary/40 bg-primary/5" : "bg-muted/20",
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      className="size-4 accent-primary"
                                      checked={checked}
                                      onChange={() =>
                                        patch((current) => ({
                                          ...current,
                                          ranges: current.ranges.map((item) => {
                                            if (item.key !== range.key) return item;
                                            const deviceIds = item.deviceIds.includes(device.deviceId)
                                              ? item.deviceIds.filter((id) => id !== device.deviceId)
                                              : [...item.deviceIds, device.deviceId];
                                            return { ...item, deviceIds };
                                          }),
                                        }))
                                      }
                                    />
                                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
                                      <DeviceGlyph name={device.name} icon={device.icon} className="size-4" />
                                    </span>
                                    <b className="min-w-0 truncate text-xs">{device.name}</b>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">אין שקעים משויכים לחשבון.</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {form.ranges.length < maxSlots ? (
                    <button
                      type="button"
                      className="mt-3 w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-3.5 font-bold text-primary"
                      onClick={() =>
                        patch((current) => {
                          const inherit = current.ranges.at(-1)?.deviceIds ?? current.deviceIds;
                          const next = clockRange(
                            "",
                            "",
                            current.startDate,
                            null,
                            null,
                            current.frequency === "weekly" ? cleanWeekdays(current.weekdays) : undefined,
                            inherit,
                          );
                          return {
                            ...current,
                            ranges:
                              current.frequency === "weekly"
                                ? applyWeekdays([...current.ranges, next], current.weekdays, current.startDate)
                                : [...current.ranges, next],
                          };
                        }, true)
                      }
                    >
                      ＋ הוסף עוד שעון
                    </button>
                  ) : null}
                  <p className="mt-4 rounded-xl bg-primary/5 px-4 py-3.5 text-xs leading-6 text-muted-foreground">
                    {form.frequency === "weekly"
                      ? "התאריך של כל שעון קובע את היום שלו. תאריך של יום ו׳ רץ ביום ו׳, ותאריך של שבת רץ בשבת."
                      : "לכל שעון בוחרים תאריך, פעולה ושעה, ואילו התקנים הוא מפעיל. אפשר להוסיף עוד הדלקה או כיבוי על אותו שעון, ואין חובה לשעה משלימה."}
                  </p>
                </div>

              ) : null}
              {form.schedule === "duration" ? (
                <div className="mt-3 rounded-2xl border bg-muted/30 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-bold">
                      שעת הדלקה
                      <input
                        className={cn(control, "mt-2 min-w-0 text-base tabular-nums sm:text-sm")}
                        dir="ltr"
                        type="time"
                        value={form.durationStart}
                        onChange={(event) => patch((current) => ({ ...current, durationStart: event.target.value }), true)}
                      />
                    </label>
                    <label className="text-xs font-bold">
                      משך ההפעלה (דקות)
                      <input
                        className={cn(control, "mt-2")}
                        type="number"
                        min={1}
                        max={1440}
                        value={form.durationMinutes}
                        onChange={(event) => patch((current) => ({ ...current, durationMinutes: event.target.value }), true)}
                      />
                    </label>
                  </div>
                  <p className="mt-3 rounded-xl bg-primary/5 px-3 py-3 text-xs leading-6 text-muted-foreground">{durationText(form)}</p>
                </div>
              ) : null}
              {form.schedule === "sun" ? (
                <div className="mt-3 rounded-2xl border bg-muted/30 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-bold">
                      אירוע
                      <select className={cn(control, "mt-2")} value={form.sunEvent} onChange={(event) => patch((current) => ({ ...current, sunEvent: event.target.value as FormState["sunEvent"] }))}>
                        {Object.entries(SUN_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-bold">
                      הפרש בדקות (שלילי = לפני)
                      <input
                        className={cn(control, "mt-2")}
                        type="number"
                        min={-180}
                        max={180}
                        value={form.sunOffset}
                        onChange={(event) => patch((current) => ({ ...current, sunOffset: event.target.value }))}
                      />
                    </label>
                    <label className="text-xs font-bold">
                      עיר
                      <select className={cn(control, "mt-2")} value={form.city} onChange={(event) => patch((current) => ({ ...current, city: event.target.value }))}>
                        {draft.places.map((place) => (
                          <option key={place.id} value={place.id}>
                            {place.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-bold">
                      פעולה
                      <select className={cn(control, "mt-2")} value={form.sunAction} onChange={(event) => patch((current) => ({ ...current, sunAction: event.target.value === "off" ? "off" : "on" }))}>
                        <option value="on">הדלקה</option>
                        <option value="off">כיבוי</option>
                      </select>
                    </label>
                  </div>
                  <p className="mt-3 rounded-xl bg-primary/5 px-3 py-3 text-xs leading-6 text-muted-foreground">
                    <b>חשוב:</b> זמני השבת והיום מוצגים בלוח לפי העיר. שמירה לפי הזמנים האלה עדיין לא מפעילה שקע, כי השעה משתנה מיום ליום וצריכה להיקבע מחדש בכל יום.
                  </p>
                </div>
              ) : null}
            </section>
            {form.schedule === "times" ? null : (
              <section className="mb-8">
                <SectionTitle n="04">באילו שקעים?</SectionTitle>
                {draft.devices.length ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {draft.devices.map((device) => {
                      const checked = form.deviceIds.includes(device.deviceId);
                      return (
                        <label
                          key={device.deviceId}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-2xl border p-4",
                            checked ? "border-primary/40 bg-primary/5" : "bg-card",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={checked}
                            onChange={() =>
                              patch((current) => ({
                                ...current,
                                deviceIds: current.deviceIds.includes(device.deviceId)
                                  ? current.deviceIds.filter((id) => id !== device.deviceId)
                                  : [...current.deviceIds, device.deviceId],
                              }))
                            }
                          />
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
                            <DeviceGlyph name={device.name} icon={device.icon} className="size-4" />
                          </span>
                          <b className="min-w-0 truncate text-sm">{device.name}</b>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">אין שקעים משויכים לחשבון.</p>
                )}
                <p className="mt-4 rounded-xl bg-primary/5 px-4 py-3.5 text-xs leading-6 text-muted-foreground">הרשימה היא השקעים של החשבון.</p>
              </section>
            )}
            <section className="mb-6 overflow-hidden rounded-2xl border">
              <button
                type="button"
                className="flex w-full items-center justify-between bg-muted/40 px-4 py-4 text-start font-extrabold"
                aria-expanded={advanced}
                onClick={() => setAdvanced((open) => !open)}
              >
                <span>אפשרויות מתקדמות</span>
                <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
              </button>
              {advanced ? (
                <div className="px-4 py-4">
                  <Check label="התוכנית פעילה מיד לאחר שמירה" checked={form.enabled} onChange={(checked) => patch((current) => ({ ...current, enabled: checked }))} />
                  <Check label="בקש התראה אם פעולה נכשלה" checked={form.notify} onChange={(checked) => patch((current) => ({ ...current, notify: checked }))} />
                  <Check label="בדוק התנגשויות לפני שמירה" checked={form.conflict} onChange={(checked) => patch((current) => ({ ...current, conflict: checked }))} />
                  <Check label="אפשר לדלג על ההפעלה הבאה" checked={form.skip} onChange={(checked) => patch((current) => ({ ...current, skip: checked }))} />
                  <p className="rounded-xl bg-primary/5 px-3 py-3 text-xs leading-6 text-muted-foreground">
                    בדיקת ההתנגשויות רצה לפני השמירה. התראה על כישלון ודילוג על ההפעלה הבאה נשמרים עם התוכנית, וההפעלה עצמה נשמרת בחשבון.
                  </p>
                </div>
              ) : null}
            </section>
            <section>
              <h3 className="mb-3 text-[15px] font-extrabold">סיכום התוכנית</h3>
              <p className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 leading-7 text-muted-foreground">{summaryText(form, draft.places)}</p>
              {shownError ? (
                <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                  {shownError}
                </p>
              ) : null}
            </section>
          </div>
          <div className="flex flex-col gap-3 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-4">
            <p className="text-xs leading-5 text-muted-foreground">
              השמירה בחשבון, והשקעים יפעלו לפי התוכנית
              {editing ? (
                <button
                  type="button"
                  className="ms-3 font-bold text-destructive"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(form.programId ? "למחוק את התוכנית?" : "למחוק את השעון?")) onDelete();
                  }}
                >
                  מחיקה
                </button>
              ) : null}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button type="button" variant="outline" className="h-11 rounded-xl px-4" disabled={pending} onClick={reset}>
                ניקוי
              </Button>
              <Button type="submit" className="h-11 rounded-xl px-4" disabled={pending}>
                {pending ? "שומר…" : "שמירת תוכנית"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ n, children }: { n: string; children: ReactNode }) {
  return (
    <h3 className="mb-3 flex items-start gap-2 text-[15px] leading-6 font-extrabold sm:text-base">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs text-primary">{n}</span>
      <span className="min-w-0">{children}</span>
    </h3>
  );
}

function Choice({
  active,
  icon,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-3 py-3 text-start sm:block sm:px-3 sm:py-4 sm:text-center",
        active ? "border-primary bg-primary/5 shadow-[inset_0_0_0_1px_var(--primary)]" : "border-border bg-card",
      )}
      onClick={onClick}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary sm:mx-auto sm:mb-2 sm:size-auto sm:bg-transparent">{icon}</span>
      <span className="min-w-0">
        <strong className="block text-sm leading-5">{title}</strong>
        <small className="mt-0.5 block text-xs leading-5 text-muted-foreground">{detail}</small>
      </span>
    </button>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="mb-3 flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-primary" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
