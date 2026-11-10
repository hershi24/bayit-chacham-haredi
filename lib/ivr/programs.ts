import { spokenClockTime, spokenDateWords, type MenuRead } from "@/lib/ivr/flow";
import { syncTenantPrograms } from "@/lib/programs/sync";
import type { ProgramSlot, StoredProgram } from "@/lib/programs/types";
import { getDevice, listPrograms, upsertProgram } from "@/lib/store";

const WORDS = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];
const SPOKEN_DAYS = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];

export type ProgramsDecision = MenuRead | { type: "say"; message: string };

export async function answerPrograms(
  deviceId: string,
  input: {
    program?: string;
    op?: string;
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
    const on = parsePhoneClock(input.on);
    if (!on) {
      return askOn(input.on ? "השעה לא תקינה, " : `${scheduleSpeech(item)}, `);
    }
    await saveTimes(item, on, primarySlot(item).offTime);
    deferSync(device.tenantId);
    return {
      type: "say",
      message: `תוכנית ${item.name}, שעת הדלקה עודכנה ל${spokenClockTime(on)}`,
    };
  }

  if (input.op === "3") {
    const off = parsePhoneClock(input.off);
    if (!off) {
      return askOff(input.off ? "השעה לא תקינה, " : `${scheduleSpeech(item)}, `);
    }
    await saveTimes(item, primarySlot(item).onTime, off);
    deferSync(device.tenantId);
    return {
      type: "say",
      message: `תוכנית ${item.name}, שעת כיבוי עודכנה ל${spokenClockTime(off)}`,
    };
  }

  return detailMenu(item, "הבחירה לא קיימת");
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
  return `תוכנית ${program.name} הופעלה, ${scheduleSpeech(program)}`;
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
  const head = prefix
    ? `${prefix}. תוכנית ${program.name}, ${state}`
    : `תוכנית ${program.name}, ${state}`;
  return {
    type: "read",
    message: `${head}, ${scheduleSpeech(program)}. להפעלה או כיבוי הקש אחד, לעריכת שעת הדלקה הקש שתיים, לעריכת שעת כיבוי הקש שלוש`,
    field: "pikud_program_op",
    min: 1,
    max: 1,
    allowed: "123",
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

export function scheduleSpeech(program: StoredProgram): string {
  const when = speakWhen(program);
  const slot = primarySlot(program);
  const parts: string[] = [];
  if (when) parts.push(when);
  if (slot.onTime) parts.push(`יידלק ב${spokenClockTime(slot.onTime)}`);
  if (slot.offTime) parts.push(`יכבה ב${spokenClockTime(slot.offTime)}`);
  if (slot.onTime && slot.offTime && slot.offTime <= slot.onTime) parts.push("הכיבוי למחרת");
  if (!slot.onTime && !slot.offTime) parts.push("בלי שעות הדלקה וכיבוי");
  return parts.join(", ");
}

function speakWhen(program: StoredProgram): string {
  if (program.weekdays.length === 7) return "כל יום";
  if (program.weekdays.length) {
    const days = [...new Set(program.weekdays.filter((day) => day >= 0 && day <= 6))]
      .sort((left, right) => left - right)
      .map((day) => SPOKEN_DAYS[day]);
    if (days.length === 1) return days[0] ?? "";
    if (days.length === 2) return `${days[0]} ו${days[1]}`;
    return `${days.slice(0, -1).join(", ")} ו${days[days.length - 1]}`;
  }
  if (program.days.length === 1) return `בתאריך ${spokenDateWords(program.days[0])}`;
  if (program.days.length) return `ב${program.days.length} ימים שנבחרו`;
  return "";
}

function primarySlot(program: StoredProgram): ProgramSlot {
  if (program.slots[0]) return program.slots[0];
  return { onTime: program.onTime, offTime: program.offTime };
}

async function saveTimes(program: StoredProgram, onTime: string | null, offTime: string | null) {
  const slots =
    program.slots.length > 0
      ? program.slots.map((slot, index) => (index === 0 ? { ...slot, onTime, offTime } : slot))
      : [{ onTime, offTime }];
  await upsertProgram({ ...program, onTime, offTime, slots });
}

function parsePhoneClock(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}$/.test(value)) return null;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2));
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
