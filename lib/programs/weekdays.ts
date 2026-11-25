export const WEEKDAY_LABELS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];

export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function cleanWeekdays(weekdays: number[]): number[] {
  return [...new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => left - right);
}

/**
 * The days marked on the program are the days every clock runs.
 * A Friday date and a Saturday date stay apart. Clocks that share one date run on all marked days.
 */
export function weeklyClockDays(dates: string[], selected: number[]): number[][] {
  const days = cleanWeekdays(selected);
  const dated = dates.map((date) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? weekdayOf(date) : null));
  const distinct = new Set(dated.filter((day): day is number => day != null && (!days.length || days.includes(day))));
  if (distinct.size > 1) {
    return dated.map((day) => (day != null && (!days.length || days.includes(day)) ? [day] : days));
  }
  if (days.length) return dates.map(() => days);
  return dated.map((day) => (day == null ? [] : [day]));
}

/** A program saved before the marked days were kept pinned every clock to one weekday. Those clocks run on every marked day. */
export function sharedClockDays<T extends { weekdays?: number[] }>(slots: T[], selected: number[]): T[] {
  const days = cleanWeekdays(selected);
  if (days.length < 2 || slots.length === 0) return slots;
  const pinned = slots.map((slot) => cleanWeekdays(slot.weekdays ?? []));
  const only = pinned[0]?.[0];
  if (only == null || !days.includes(only) || !pinned.every((row) => row.length === 1 && row[0] === only)) return slots;
  return slots.map((slot) => ({ ...slot, weekdays: days }));
}

export function weekdayPhrase(weekdays: number[]): string {
  const days = cleanWeekdays(weekdays);
  if (days.length === 7) return "כל יום";
  if (days.join(",") === "0,1,2,3,4") return "כל יום חוץ משישי ושבת";
  if (!days.length) return "";
  return days.map((day) => WEEKDAY_LABELS[day]).join(" ");
}

function shortDay(iso: string) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${Number(day)}.${Number(month)}.${year.slice(2)}`;
}

export function repeatCaption(input: {
  weekdays: number[];
  startDate: string | null;
  endDate?: string | null;
  days: string[];
}) {
  const start = input.startDate || [...input.days].sort()[0] || "";
  const from = start ? `מ־${shortDay(start)}` : "";
  const until = input.endDate ? ` עד ${shortDay(input.endDate)}` : "";
  if (input.weekdays.length === 7) return [from, "כל יום"].filter(Boolean).join(" · ") + until;
  if (input.weekdays.length) {
    return [from, `כל שבוע ${weekdayPhrase(input.weekdays)}`].filter(Boolean).join(" · ") + until;
  }
  if (input.days.length === 1) return shortDay(input.days[0]);
  if (input.days.length) return `${from || shortDay(input.days[0])} · ${input.days.length} תאריכים`;
  return "בלי ימים";
}
