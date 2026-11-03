import type { ProgramSlot } from "@/lib/programs/types";

export const maxSlots = 12;

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function time(value: unknown): string | null {
  return typeof value === "string" && timePattern.test(value) ? value : null;
}

export function sortSlots(slots: ProgramSlot[]): ProgramSlot[] {
  return [...slots].sort((left, right) =>
    (left.onTime ?? left.offTime ?? "").localeCompare(right.onTime ?? right.offTime ?? ""),
  );
}

export function parseSlots(raw: unknown, onTime: string | null, offTime: string | null): ProgramSlot[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      parsed = [];
    }
  }
  const slots = Array.isArray(parsed)
    ? parsed
        .map((item) => {
          const record = (item ?? {}) as Record<string, unknown>;
          return { onTime: time(record.onTime), offTime: time(record.offTime) };
        })
        .filter((slot) => slot.onTime || slot.offTime)
    : [];
  if (slots.length) return sortSlots(slots).slice(0, maxSlots);
  return onTime || offTime ? [{ onTime, offTime }] : [];
}
