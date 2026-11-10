import { spokenClockTime, spokenDateWords, type MenuRead } from "@/lib/ivr/flow";
import { sortSlots } from "@/lib/programs/slots";
import { syncTenantPrograms } from "@/lib/programs/sync";
import type { ProgramSlot, StoredProgram } from "@/lib/programs/types";
import { getDevice, listPrograms, upsertProgram } from "@/lib/store";

const WORDS = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];
const SPOKEN_DAYS = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const MAX_SPOKEN_SLOTS = 8;

export type ProgramsDecision = MenuRead | { type: "say"; message: string };

export async function answerPrograms(
  deviceId: string,
  input: {
    program?: string;
    op?: string;
    slot?: string;
    side?: string;
    on?: string;
    off?: string;
  },
): Promise<ProgramsDecision> {
  const device = await getDevice(deviceId);
  if (!device?.tenantId) return { type: "say", message: "השקע לא נמצא" };
  const deviceName = device.name.trim() || "השקע";
  const programs = (await listPrograms(device.tenantId))
    .filter((program) => program.programKey.startsWith("days:"))
    .filter((program) => !program.deviceIds.length || program.deviceIds.includes(deviceId))
    .slice(0, 8);

  if (!programs.length) return { type: "say", message: emptyMessage(deviceName) };
  if (!input.program) return listMenu(programs, deviceName);

  const index = Number(input.program) - 1;
  const item = programs[index];
  if (!item || !Number.isInteger(index)) {
    return listMenu(programs, deviceName, "הבחירה לא קיימת");
  }

  if (!input.op) return detailMenu(item);

  if (input.op === "1") {
    const enabled = !item.enabled;
    await upsertProgram({ ...item, enabled });
    deferSync(device.tenantId);
    return { type: "say", message: confirmToggle(item, enabled) };
  }

  if (input.op === "2") {
    return editClockFlow(item, device.tenantId, input);
  }

  return detailMenu(item, "הבחירה לא קיימת");
}

async function editClockFlow(
  program: StoredProgram,
  tenantId: string,
  input: { slot?: string; side?: string; on?: string; off?: string },
): Promise<ProgramsDecision> {
  const slots = programSlots(program);
  if (!slots.length) {
    return { type: "say", message: `לתוכנית ${program.name} אין עדיין שעות. אפשר להגדיר שעון באתר` };
  }

  let slotIndex = 0;
  if (slots.length > 1) {
    if (!input.slot) return pickSlotMenu(program, slots);
    slotIndex = Number(input.slot) - 1;
    if (!slots[slotIndex] || !Number.isInteger(slotIndex)) {
      return pickSlotMenu(program, slots, "הבחירה לא קיימת");
    }
  }

  const slot = slots[slotIndex]!;
  const label = `שעון ${WORDS[slotIndex + 1] ?? String(slotIndex + 1)}`;

  if (input.side !== "1" && input.side !== "2") {
    return {
      type: "read",
      message: `${clockLine(slot, slotIndex, program, true)}. לעריכת שעת הדלקה של ${label} הקש אחד, לעריכת שעת כיבוי הקש שתיים`,
      field: "pikud_side",
      min: 1,
      max: 1,
      allowed: "12",
      mode: "No",
    };
  }

  if (input.side === "1") {
    const on = parsePhoneClock(input.on);
    if (!on) {
      return askOn(input.on ? "השעה לא תקינה, " : `${label}, `);
    }
    await saveSlotTimes(program, slotIndex, on, slot.offTime);
    deferSync(tenantId);
    return {
      type: "say",
      message: `תוכנית ${program.name}, ${label}, שעת הדלקה עודכנה ל${spokenClockTime(on)}`,
    };
  }

  const off = parsePhoneClock(input.off);
  if (!off) {
    return askOff(input.off ? "השעה לא תקינה, " : `${label}, `);
  }
  await saveSlotTimes(program, slotIndex, slot.onTime, off);
  deferSync(tenantId);
  return {
    type: "say",
    message: `תוכנית ${program.name}, ${label}, שעת כיבוי עודכנה ל${spokenClockTime(off)}`,
  };
}

function emptyMessage(deviceName: string) {
  return `ל${deviceName} אין עדיין תוכניות. אפשר להגדיר תוכנית באתר`;
}

function deferSync(tenantId: string) {
  void syncTenantPrograms(tenantId).catch((error: unknown) => {
    console.error("[pikud] program sync after ivr edit", error);
  });
}

function confirmToggle(program: StoredProgram, enabled: boolean) {
  if (!enabled) return `תוכנית ${program.name} כובתה`;
  return `תוכנית ${program.name} הופעלה`;
}

function listMenu(programs: StoredProgram[], deviceName: string, prefix = ""): MenuRead {
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

function detailMenu(program: StoredProgram, prefix = ""): MenuRead {
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

function pickSlotMenu(program: StoredProgram, slots: ProgramSlot[], prefix = ""): MenuRead {
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

function askOn(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשעת הדלקה הקש ארבע ספרות. לעשר בבוקר הקש אחת אפס אפס אפס`,
    field: "pikud_on",
    min: 4,
    max: 4,
    mode: "No",
  };
}

function askOff(prefix: string): MenuRead {
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
export function scheduleSpeech(program: StoredProgram): string {
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

function clockLine(slot: ProgramSlot, index: number, program: StoredProgram, includeDay: boolean): string {
  const word = WORDS[index + 1] ?? String(index + 1);
  const day = includeDay ? speakSlotDays(slot, program) : "";
  const times = speakSlotTimes(slot);
  return [`שעון ${word}`, day, times].filter(Boolean).join(", ");
}

function speakSlotTimes(slot: ProgramSlot): string {
  const parts: string[] = [];
  if (slot.onTime) parts.push(`יידלק ב${spokenClockTime(slot.onTime)}`);
  if (slot.offTime) parts.push(`יכבה ב${spokenClockTime(slot.offTime)}`);
  if (slot.onTime && slot.offTime && slot.offTime <= slot.onTime) parts.push("הכיבוי למחרת");
  if (!parts.length) return "בלי שעות הדלקה וכיבוי";
  return parts.join(", ");
}

function speakSlotDays(slot: ProgramSlot, program: StoredProgram): string {
  if (slot.weekdays?.length) return speakWeekdays(slot.weekdays);
  return speakProgramDays(program);
}

function speakProgramDays(program: StoredProgram): string {
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

export function programSlots(program: StoredProgram): ProgramSlot[] {
  if (program.slots.length) return sortSlots(program.slots);
  if (program.onTime || program.offTime) {
    return [{ onTime: program.onTime, offTime: program.offTime, weekdays: [] }];
  }
  return [];
}

async function saveSlotTimes(
  program: StoredProgram,
  slotIndex: number,
  onTime: string | null,
  offTime: string | null,
) {
  const base = programSlots(program);
  const slots = base.map((slot, index) => (index === slotIndex ? { ...slot, onTime, offTime } : slot));
  const first = slots[0];
  await upsertProgram({
    ...program,
    onTime: first?.onTime ?? null,
    offTime: first?.offTime ?? null,
    slots,
  });
}

function parsePhoneClock(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}$/.test(value)) return null;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2));
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
