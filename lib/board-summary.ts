export function boardLine(connected: number, running: number) {
  return `${hebrewCount(connected, "מחובר", "מחוברים")} · ${hebrewCount(running, "פועל", "פועלים")}`;
}

function hebrewCount(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
