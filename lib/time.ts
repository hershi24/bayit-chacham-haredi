const ISRAEL = "Asia/Jerusalem";

export function nextJerusalemClock(hour: number, minute: number, now = new Date()): { at: Date; today: boolean } {
  const today = jerusalemParts(now);
  const todayAt = zonedToUtc(Number(today.year), Number(today.month), Number(today.day), hour, minute);
  if (todayAt.getTime() > now.getTime() + 30_000) return { at: todayAt, today: true };
  const tomorrow = jerusalemParts(new Date(todayAt.getTime() + 30 * 60 * 60 * 1000));
  return {
    at: zonedToUtc(Number(tomorrow.year), Number(tomorrow.month), Number(tomorrow.day), hour, minute),
    today: false,
  };
}

function jerusalemParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ISRAEL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function jerusalemOffsetMinutes(instant: Date): number {
  const parts = jerusalemParts(instant);
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((wall - instant.getTime()) / 60_000);
}

function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = jerusalemOffsetMinutes(guess);
  const utc = new Date(guess.getTime() - offset * 60_000);
  const corrected = jerusalemOffsetMinutes(utc);
  if (corrected === offset) return utc;
  return new Date(guess.getTime() - corrected * 60_000);
}

export function formatIsrael(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: ISRAEL,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
