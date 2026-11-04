export function coversDay(day: string, start: string | null, end: string | null) {
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}
