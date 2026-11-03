const LABELS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];

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
  return days.map((day) => LABELS[day]).join(" ");
}
