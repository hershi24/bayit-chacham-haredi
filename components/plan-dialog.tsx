"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { CalendarClock, ChevronDown, Clock, Repeat, SunMedium, Timer } from "lucide-react";
import { DeviceGlyph } from "@/components/device-glyph";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { OccurrenceClock, OccurrenceProgram } from "@/lib/programs/occurrences";
import { maxDayClocks, maxProgramDays, maxSlots, slotsForWeekday } from "@/lib/programs/slots";
import { coversDay } from "@/lib/programs/span";
import { weekdayOf } from "@/lib/programs/weekdays";
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
type Range = { key: number; on: string; off: string; date: string; clockId: string | null; originalDate: string | null };

type FormState = {
  programId: string | null;
  looseClockId: string | null;
  hadWeekdays: boolean;
  scheduleDirty: boolean;
  name: string;
  frequency: Frequency;
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

function clockRange(on: string, off: string, date: string, clockId: string | null = null, originalDate: string | null = null): Range {
  return { key: rangeId(), on, off, date, clockId, originalDate };
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

function rangesFromProgram(draft: PlannerDraft, program: PlannerProgram): Range[] {
  const origin = program.startDate || draft.date;
  if (program.weekdays.length === 7) {
    const rows = program.slots
      .filter((slot) => slot.onTime || slot.offTime)
      .map((slot) => clockRange(slot.onTime ?? "", slot.offTime ?? "", origin));
    return rows.length ? rows : [clockRange("08:00", "09:00", origin)];
  }
  if (program.weekdays.length) {
    const rows: Range[] = [];
    for (const slot of program.slots) {
      const days = slot.weekdays?.length ? slot.weekdays : program.weekdays;
      for (const weekday of days) {
        rows.push(clockRange(slot.onTime ?? "", slot.offTime ?? "", dateForWeekday(weekday, origin)));
      }
    }
    const filled = rows.filter((range) => range.on || range.off);
    return filled.length ? filled : [clockRange("", "", origin)];
  }
  const owned = draft.clocks.filter((clock) => !clock.recurring && clock.programId === program.id);
  const rows = owned.map((clock) => clockRange(clock.onTime ?? "", clock.offTime ?? "", clock.day, clock.id, clock.day));
  return rows.length ? rows : [clockRange("", "", draft.date)];
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
    startDate: draft.date,
    endDate: "",
    schedule: "times",
    ranges: [clockRange("08:00", "09:00", draft.date)],
    durationStart: "08:00",
    durationMinutes: "45",
    sunEvent: "sunset",
    sunOffset: "-20",
    city,
    sunAction: "on",
    deviceIds: draft.devices.length === 1 ? [draft.devices[0].deviceId] : [],
    enabled: true,
    ...readPrefs(null),
  };
  if (draft.mode === "clock" && draft.clock) {
    return {
      ...base,
      looseClockId: draft.clock.id,
      startDate: draft.clock.day,
      ranges: [clockRange(draft.clock.onTime ?? "", draft.clock.offTime ?? "", draft.clock.day)],
      deviceIds: knownIds(draft.clock.deviceIds, draft.devices),
    };
  }
  const program = draft.program;
  if (draft.mode !== "program" || !program) return base;
  const weekly = program.weekdays.length > 0;
  return {
    ...base,
    programId: program.id,
    hadWeekdays: weekly,
    name: program.name,
    frequency: program.weekdays.length === 7 ? "daily" : weekly ? "weekly" : "once",
    startDate: weekly ? (program.startDate ?? draft.date) : draft.date,
    endDate: weekly ? (program.endDate ?? "") : "",
    ranges: rangesFromProgram(draft, program),
    deviceIds: knownIds(program.deviceIds, draft.devices),
    enabled: program.enabled,
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

function activeRanges(form: FormState) {
  if (form.schedule === "duration") {
    const shifted = clockShift(form.durationStart, Number(form.durationMinutes));
    return [{ on: form.durationStart, off: shifted.time, date: form.startDate, clockId: null, originalDate: null }];
  }
  return form.ranges.map((range) => ({
    on: range.on,
    off: range.off,
    date: range.date,
    clockId: range.clockId,
    originalDate: range.originalDate,
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

function cleanTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value) ? value : null;
}

function summaryText(form: FormState, places: PlannerPlace[]) {
  const name = form.name.trim() || "תוכנית ללא שם";
  const until = form.frequency !== "once" && form.endDate ? ` עד ${form.endDate}` : "";
  const when =
    form.frequency === "once"
      ? "חד־פעמית לפי תאריך כל שעון"
      : form.frequency === "daily"
        ? `בכל יום${until}`
        : `חזרה שבועית לפי תאריך כל שעון${until}`;
  const city = places.find((place) => place.id === form.city)?.name ?? "";
  const how =
    form.schedule === "times"
      ? form.ranges.map((range) => `${range.on || "--:--"}–${range.off || "--:--"} (${range.date || "תאריך חסר"})`).join(" | ")
      : form.schedule === "duration"
        ? `הדלקה ב־${form.durationStart || "--:--"} למשך ${form.durationMinutes || 0} דקות`
        : `${SUN_LABELS[form.sunEvent]} (${form.sunOffset || "0"} דקות)${city ? `, ${city}` : ""}`;
  return `${name} · ${when} · ${how} · ${form.deviceIds.length} התקנים`;
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
  if (!form.deviceIds.length) return "יש לבחור לפחות שקע אחד";
  if (form.schedule === "times") {
    if (form.ranges.length > maxSlots) return `אפשר עד ${maxSlots} שעונים בתוכנית`;
    if (form.ranges.some((range) => !range.on || !range.off)) return "יש למלא את כל שעות ההדלקה והכיבוי";
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

function intervals(today: Array<{ on: string; off: string }>, previous: Array<{ on: string; off: string }>) {
  const out: Array<[number, number]> = [];
  for (const range of today) {
    const on = range.on ? minutes(range.on) : null;
    const off = range.off ? minutes(range.off) : null;
    if (on != null && off != null) out.push(off <= on ? [on, 1440] : [on, off]);
    else if (on != null) out.push([on, on + 1]);
    else if (off != null) out.push([off, off + 1]);
  }
  for (const range of previous) {
    const on = range.on ? minutes(range.on) : null;
    const off = range.off ? minutes(range.off) : null;
    if (on != null && off != null && off <= on) out.push([0, off]);
  }
  return out;
}

function overlaps(left: [number, number], right: [number, number]) {
  return left[0] < right[1] && right[0] < left[1];
}

function draftRanges(form: FormState, day: string) {
  const chosen = activeRanges(form).filter((range) => (range.on || range.off) && isIso(range.date));
  if (form.frequency === "once") return chosen.filter((range) => range.date === day).map((range) => ({ on: range.on, off: range.off }));
  const start = seriesStart(
    form,
    chosen.map((range) => range.date),
  );
  if (!coversDay(day, start || null, form.endDate || null)) return [];
  if (form.frequency === "daily") return chosen.map((range) => ({ on: range.on, off: range.off }));
  return chosen.filter((range) => weekdayOf(range.date) === weekdayOf(day)).map((range) => ({ on: range.on, off: range.off }));
}

function storedRanges(program: PlannerProgram, clocks: PlannerClock[], day: string) {
  if (!program.enabled || (program.skippedDates ?? []).includes(day)) return [];
  if (program.weekdays.length) {
    if (!program.weekdays.includes(weekdayOf(day)) || !coversDay(day, program.startDate, program.endDate)) return [];
    return slotsForWeekday(program.slots, weekdayOf(day)).map((slot) => ({ on: slot.onTime ?? "", off: slot.offTime ?? "" }));
  }
  return clocks
    .filter((clock) => !clock.recurring && clock.programId === program.id && clock.day === day)
    .map((clock) => ({ on: clock.onTime ?? "", off: clock.offTime ?? "" }));
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
    for (const program of programs) {
      if (program.id === form.programId || !program.enabled || !form.deviceIds.some((id) => program.deviceIds.includes(id))) continue;
      const theirs = intervals(storedRanges(program, clocks, day), storedRanges(program, clocks, previous));
      if (mine.some((left) => theirs.some((right) => overlaps(left, right)))) return program.name;
    }
    for (const clock of clocks) {
      if (clock.recurring || clock.programId || clock.id === form.looseClockId) continue;
      if (!form.deviceIds.some((id) => clock.deviceIds.includes(id))) continue;
      const row = { on: clock.onTime ?? "", off: clock.offTime ?? "" };
      const theirs = intervals(clock.day === day ? [row] : [], clock.day === previous ? [row] : []);
      if (mine.some((left) => theirs.some((right) => overlaps(left, right)))) return "שעון";
    }
  }
  return null;
}

function buildBody(form: FormState) {
  const ranges = activeRanges(form).filter((range) => range.on || range.off);
  if (form.frequency === "once") {
    const grouped = new Map<string, Array<{ id: string; onTime: string | null; offTime: string | null }>>();
    for (const range of ranges) {
      const clocks = grouped.get(range.date) ?? [];
      clocks.push({
        id: range.clockId && range.date === range.originalDate ? range.clockId : "",
        onTime: cleanTime(range.on),
        offTime: cleanTime(range.off),
      });
      grouped.set(range.date, clocks);
    }
    return {
      action: "program-save",
      id: form.programId,
      name: form.name.trim(),
      deviceIds: form.deviceIds,
      enabled: form.enabled,
      replaceClockId: form.looseClockId,
      days: [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, clocks]) => ({ date, clocks })),
    };
  }
  const seen = new Set<string>();
  const slots = ranges.flatMap((range) => {
    const onTime = cleanTime(range.on);
    const offTime = cleanTime(range.off);
    if (form.frequency === "daily") {
      const key = `${onTime}|${offTime}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ onTime, offTime, weekdays: [] as number[] }];
    }
    return [{ onTime, offTime, weekdays: isIso(range.date) ? [weekdayOf(range.date)] : [] }];
  });
  const weekdays =
    form.frequency === "daily"
      ? [0, 1, 2, 3, 4, 5, 6]
      : [...new Set(ranges.flatMap((range) => (isIso(range.date) ? [weekdayOf(range.date)] : [])))].sort((left, right) => left - right);
  return {
    action: "repeat-save",
    id: form.programId,
    name: form.name.trim(),
    weekdays,
    slots,
    deviceIds: form.deviceIds,
    enabled: form.enabled,
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
        className="max-h-[min(92vh,920px)] gap-0 overflow-hidden p-0 sm:max-w-[920px]"
        style={{ width: "min(920px, calc(100vw - 2rem))", display: "flex", flexDirection: "column", maxHeight: "min(92vh, 920px)" }}
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
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
            <section className="mb-6">
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
            <section className="mb-6">
              <SectionTitle n="02">מתי התוכנית תפעל?</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
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
                  detail="לפי תאריך כל שעון"
                  onClick={() => patch((current) => (current.frequency === "weekly" ? current : { ...current, frequency: "weekly", scheduleDirty: true }))}
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
              </div>
            </section>
            <section className="mb-6">
              <SectionTitle n="03">איך ההתקנים יפעלו?</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                <Choice
                  active={form.schedule === "times"}
                  icon={<Clock className="mx-auto size-5" />}
                  title="שעות קבועות"
                  detail="הדלקה וכיבוי"
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
                        <label className="mb-3 block text-xs font-bold">
                          תאריך השעון — לחיצה פותחת לוח שנה
                          <input
                            className={cn(control, "mt-2")}
                            dir="ltr"
                            type="date"
                            required
                            value={range.date}
                            aria-label={`תאריך, שעון ${index + 1}`}
                            onChange={(event) =>
                              patch(
                                (current) => ({
                                  ...current,
                                  ranges: current.ranges.map((item) => (item.key === range.key ? { ...item, date: event.target.value } : item)),
                                }),
                                true,
                              )
                            }
                          />
                          <span className="mt-1 block text-[11px] font-medium text-muted-foreground">
                            אפשר לבחור תאריך אחר לכל שעון באותה תוכנית. במצב שבועי, השעון יחזור בכל שבוע ביום המתאים לתאריך שבחרת.
                          </span>
                        </label>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-xs font-bold">
                            <span className="mb-1 flex items-center gap-1">
                              <i className="size-1.5 rounded-full bg-online" /> הדלקה
                            </span>
                            <input
                              className={control}
                              dir="ltr"
                              type="time"
                              value={range.on}
                              aria-label={`הדלקה, טווח ${index + 1}`}
                              onChange={(event) =>
                                patch(
                                  (current) => ({
                                    ...current,
                                    ranges: current.ranges.map((item) => (item.key === range.key ? { ...item, on: event.target.value } : item)),
                                  }),
                                  true,
                                )
                              }
                            />
                          </label>
                          <label className="text-xs font-bold">
                            <span className="mb-1 flex items-center gap-1">
                              <i className="size-1.5 rounded-full bg-destructive" /> כיבוי
                            </span>
                            <input
                              className={control}
                              dir="ltr"
                              type="time"
                              value={range.off}
                              aria-label={`כיבוי, טווח ${index + 1}`}
                              onChange={(event) =>
                                patch(
                                  (current) => ({
                                    ...current,
                                    ranges: current.ranges.map((item) => (item.key === range.key ? { ...item, off: event.target.value } : item)),
                                  }),
                                  true,
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  {form.ranges.length < maxSlots ? (
                    <button
                      type="button"
                      className="mt-2 w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-3 font-bold text-primary"
                      onClick={() =>
                        patch(
                          (current) => ({
                            ...current,
                            ranges: [...current.ranges, clockRange("", "", current.startDate)],
                          }),
                          true,
                        )
                      }
                    >
                      ＋ הוסף עוד טווח שעות
                    </button>
                  ) : null}
                  <p className="mt-3 rounded-xl bg-primary/5 px-3 py-3 text-xs leading-6 text-muted-foreground">
                    לכל שעון בוחרים תאריך משלו מתוך לוח שנה. אפשר להוסיף כמה שעונים לאותו תאריך, או לבחור תאריכים שונים. כיבוי בשעה מוקדמת מההדלקה ייחשב לכיבוי ביום הבא.
                  </p>
                </div>
              ) : null}
              {form.schedule === "duration" ? (
                <div className="mt-3 rounded-2xl border bg-muted/30 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-bold">
                      שעת הדלקה
                      <input
                        className={cn(control, "mt-2")}
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
            <section className="mb-6">
              <SectionTitle n="04">באילו שקעים?</SectionTitle>
              {draft.devices.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {draft.devices.map((device) => {
                    const checked = form.deviceIds.includes(device.deviceId);
                    return (
                      <label
                        key={device.deviceId}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-xl border p-3",
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
              <p className="mt-3 rounded-xl bg-primary/5 px-3 py-3 text-xs leading-6 text-muted-foreground">הרשימה היא השקעים של החשבון.</p>
            </section>
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 sm:px-8">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">השמירה בחשבון, והשקעים יפעלו לפי התוכנית</span>
              {editing ? (
                <button type="button" className="text-sm font-bold text-destructive" disabled={pending} onClick={() => {
                  if (window.confirm(form.programId ? "למחוק את התוכנית?" : "למחוק את השעון?")) onDelete();
                }}>
                  מחיקה
                </button>
              ) : null}
            </div>
            <div className="flex gap-2">
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
    <h3 className="mb-3 flex items-center gap-2 text-[15px] font-extrabold">
      <span className="grid size-6 place-items-center rounded-lg bg-primary/10 text-xs text-primary">{n}</span>
      {children}
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
        "rounded-xl border px-2 py-3 text-center",
        active ? "border-primary bg-primary/5 shadow-[0_0_0_1px_var(--primary)]" : "border-border bg-card",
      )}
      onClick={onClick}
    >
      <span className="mb-1 block text-primary">{icon}</span>
      <strong className="block text-[13px]">{title}</strong>
      <small className="mt-0.5 block text-[11px] text-muted-foreground">{detail}</small>
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
