export function skipsHoliday(program: { skipHolidays?: boolean }, day: string, yomTov: ReadonlySet<string>) {
  return Boolean(program.skipHolidays) && yomTov.has(day);
}
