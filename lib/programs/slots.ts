import type { ProgramSlot } from "@/lib/programs/types";
import { cleanWeekdays } from "@/lib/programs/weekdays";

export const maxSlots = 24;
export const maxProgramDays = 31;
export const maxDayClocks = 12;

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function time(value: unknown): string | null {
  return typeof value === "string" && timePattern.test(value) ? value : null;
}

export function sortSlots(slots: ProgramSlot[]): ProgramSlot[] {
  return [...slots].sort((left, right) => slotRank(left).localeCompare(slotRank(right)));
}

function slotRank(slot: ProgramSlot) {
  const day = slot.weekdays?.length === 1 ? String(slot.weekdays[0]) : "";
  return `${day} ${slot.onTime ?? slot.offTime ?? ""}`;
}

export function slotsForWeekday<T extends { weekdays?: number[] }>(slots: T[], weekday: number): T[] {
  return slots.filter((slot) => !slot.weekdays?.length || slot.weekdays.includes(weekday));
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
          return {
            onTime: time(record.onTime),
            offTime: time(record.offTime),
            weekdays: Array.isArray(record.weekdays) ? cleanWeekdays(record.weekdays.map((item) => Number(item))) : [],
          };
        })
        .filter((slot) => slot.onTime || slot.offTime)
    : [];
  if (slots.length) return sortSlots(slots).slice(0, maxSlots);
  return onTime || offTime ? [{ onTime, offTime, weekdays: [] }] : [];
}
