export const WEEKDAY_LABELS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];

export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function cleanWeekdays(weekdays: number[]): number[] {
  return [...new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => left - right);
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
