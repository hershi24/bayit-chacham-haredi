import { spokenClockTime, spokenDateWords, type MenuRead } from "@/lib/ivr/flow";
import { resolveActions } from "@/lib/programs/actions";
import { sortSlots } from "@/lib/programs/slots";
import type { ProgramSlot, StoredProgram } from "@/lib/programs/types";

export const WORDS = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];
const SPOKEN_DAYS = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const MAX_SPOKEN_SLOTS = 8;

export type SpokenProgram = Pick<StoredProgram, "name" | "enabled" | "slots" | "onTime" | "offTime" | "weekdays" | "days">;

export function emptyMessage(deviceName: string) {
  return `ל${deviceName} אין עדיין תוכניות. אפשר להגדיר תוכנית באתר`;
}

export function noHoursMessage(program: SpokenProgram) {
  return `לתוכנית ${program.name} אין עדיין שעות. אפשר להגדיר שעון באתר`;
}

export function confirmToggle(program: SpokenProgram, enabled: boolean) {
  if (!enabled) return `תוכנית ${program.name} כובתה`;
  return `תוכנית ${program.name} הופעלה`;
}

export function slotLabel(slotIndex: number) {
  return `שעון ${WORDS[slotIndex + 1] ?? String(slotIndex + 1)}`;
}

export function slotUpdated(program: SpokenProgram, slotIndex: number, side: "on" | "off", clock: string) {
  const what = side === "on" ? "שעת הדלקה" : "שעת כיבוי";
  return `תוכנית ${program.name}, ${slotLabel(slotIndex)}, ${what} עודכנה ל${spokenClockTime(clock)}`;
}

export function listMenu(programs: SpokenProgram[], deviceName: string, prefix = ""): MenuRead {
  const choices = programs
    .map((program, index) => {
      const word = WORDS[index + 1] ?? String(index + 1);
      const state = program.enabled ? "פעילה כעת" : "כבויה כעת";
      return `תוכנית ${word}, ${program.name}, ${state}, לבחירה הקש ${word}`;
    })
    .join(". ");
  const head = prefix ? `${prefix}. תפריט תוכניות ל${deviceName}` : `תפריט תוכניות ל${deviceName}`;
  return {
    type: "read",
    message: `${head}. ${choices}`.replace(/\s+/g, " ").trim(),
    field: "pikud_program",
    min: 1,
    max: 1,
    allowed: programs.map((_, index) => String(index + 1)).join(""),
    mode: "No",
  };
}

export function detailMenu(program: SpokenProgram, prefix = ""): MenuRead {
  const state = program.enabled ? "פעילה כעת" : "כבויה כעת";
  const title = prefix
    ? `${prefix}. תוכנית ${program.name}, ${state}`
    : `תוכנית ${program.name}, ${state}`;
  // Title, then every clock in order, then a short edit menu — each as its own sentence.
  return {
    type: "read",
    message: `${title}. ${scheduleSpeech(program)}. להפעלה או כיבוי של כל התוכנית הקש אחד. לעריכת שעון בודד הקש שתיים`,
    field: "pikud_program_op",
    min: 1,
    max: 1,
    allowed: "12",
    mode: "No",
  };
}

export function pickSlotMenu(program: SpokenProgram, slots: ProgramSlot[], prefix = ""): MenuRead {
  const listed = slots.slice(0, MAX_SPOKEN_SLOTS);
  const choices = listed
    .map((slot, index) => {
      const word = WORDS[index + 1] ?? String(index + 1);
      return `ל${clockLine(slot, index, program, true)} הקש ${word}`;
    })
    .join(". ");
  const head = prefix ? `${prefix}. איזה שעון לערוך בתוכנית ${program.name}` : `איזה שעון לערוך בתוכנית ${program.name}`;
  return {
    type: "read",
    message: `${head}. ${choices}`,
    field: "pikud_program_slot",
    min: 1,
    max: 1,
    allowed: listed.map((_, index) => String(index + 1)).join(""),
    mode: "No",
  };
}

export function slotSideMenu(program: SpokenProgram, slot: ProgramSlot, slotIndex: number): MenuRead {
  return {
    type: "read",
    message: `${clockLine(slot, slotIndex, program, true)}. לעריכת שעת הדלקה של ${slotLabel(slotIndex)} הקש אחד, לעריכת שעת כיבוי הקש שתיים`,
    field: "pikud_side",
    min: 1,
    max: 1,
    allowed: "12",
    mode: "No",
  };
}

export function askOn(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשעת הדלקה הקש ארבע ספרות. לעשר בבוקר הקש אחת אפס אפס אפס`,
    field: "pikud_on",
    min: 4,
    max: 4,
    mode: "No",
  };
}

export function askOff(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשעת כיבוי הקש ארבע ספרות. לשתים עשרה הקש אחת שתיים אפס אפס`,
    field: "pikud_off",
    min: 4,
    max: 4,
    mode: "No",
  };
}

/** Full ordered reading of every on/off clock on the program. */
export function scheduleSpeech(program: SpokenProgram): string {
  const slots = programSlots(program);
  if (!slots.length) {
    const when = speakProgramDays(program);
    return [when, "בלי שעות הדלקה וכיבוי"].filter(Boolean).join(". ");
  }

  const perSlotDays = slotsHaveOwnDays(slots);
  const sharedDays = perSlotDays ? "" : speakProgramDays(program);
  const listed = slots.slice(0, MAX_SPOKEN_SLOTS);
  const lines = listed.map((slot, index) => clockLine(slot, index, program, perSlotDays));
  const extra =
    slots.length > MAX_SPOKEN_SLOTS ? `עוד ${slots.length - MAX_SPOKEN_SLOTS} שעונים מופיעים באתר` : "";
  return [sharedDays ? `בימים: ${sharedDays}` : "", ...lines, extra].filter(Boolean).join(". ");
}

function clockLine(slot: ProgramSlot, index: number, program: SpokenProgram, includeDay: boolean): string {
  const word = WORDS[index + 1] ?? String(index + 1);
  const day = includeDay ? speakSlotDays(slot, program) : "";
  const times = speakSlotTimes(slot);
  return [`שעון ${word}`, day, times].filter(Boolean).join(", ");
}

function speakSlotTimes(slot: ProgramSlot): string {
  const actions = resolveActions(slot);
  if (!actions.length) return "בלי שעות הדלקה וכיבוי";
  const classic =
    actions.length === 2 && actions[0]?.action === "ON" && actions[1]?.action === "OFF" && !actions[0].nextDay;
  if (classic && actions[1]) {
    const parts = [`יידלק ב${spokenClockTime(actions[0].time)}`, `יכבה ב${spokenClockTime(actions[1].time)}`];
    if (actions[1].nextDay) parts.push("הכיבוי למחרת");
    return parts.join(", ");
  }
  return actions
    .map((step) => `${step.action === "ON" ? "יידלק" : "יכבה"} ב${spokenClockTime(step.time)}`)
    .join(", ");
}

function speakSlotDays(slot: ProgramSlot, program: SpokenProgram): string {
  if (slot.weekdays?.length) return speakWeekdays(slot.weekdays);
  return speakProgramDays(program);
}

function speakProgramDays(program: SpokenProgram): string {
  if (program.weekdays.length) return speakWeekdays(program.weekdays);
  if (program.days.length === 1) return `בתאריך ${spokenDateWords(program.days[0])}`;
  if (program.days.length) return `ב${program.days.length} ימים שנבחרו`;
  return "";
}

function speakWeekdays(weekdays: number[]): string {
  const days = [...new Set(weekdays.filter((day) => day >= 0 && day <= 6))].sort((left, right) => left - right);
  if (days.length === 7) return "כל יום";
  if (days.join(",") === "0,1,2,3,4") return "כל יום חוץ משישי ושבת";
  const names = days.map((day) => SPOKEN_DAYS[day] ?? "");
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} ו${names[1]}`;
  return `${names.slice(0, -1).join(", ")} ו${names[names.length - 1]}`;
}

function slotsHaveOwnDays(slots: ProgramSlot[]): boolean {
  return slots.some((slot) => (slot.weekdays?.length ?? 0) > 0);
}

export function programSlots(program: SpokenProgram): ProgramSlot[] {
  if (program.slots.length) return sortSlots(program.slots);
  if (program.onTime || program.offTime) {
    return [{ onTime: program.onTime, offTime: program.offTime, weekdays: [] }];
  }
  return [];
}

export function parsePhoneClock(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}$/.test(value)) return null;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2));
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
