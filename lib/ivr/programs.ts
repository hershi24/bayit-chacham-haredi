import { syncTenantPrograms } from "@/lib/programs/sync";
import { weekdayPhrase } from "@/lib/programs/weekdays";
import { getDevice, listPrograms, upsertProgram } from "@/lib/store";
import type { StoredProgram } from "@/lib/programs/types";

const WORDS = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];

export async function answerPrograms(deviceId: string, digit: string | undefined) {
  const device = await getDevice(deviceId);
  if (!device?.tenantId) return { type: "say" as const, message: "השקע לא נמצא" };
  const deviceName = device.name.trim() || "השקע";
  const programs = (await listPrograms(device.tenantId))
    .filter((program) => program.programKey.startsWith("days:"))
    .filter((program) => !program.deviceIds.length || program.deviceIds.includes(deviceId))
    .slice(0, 8);

  if (digit) {
    const index = Number(digit) - 1;
    const item = programs[index];
    if (!item || !Number.isInteger(index)) {
      if (!programs.length) return { type: "say" as const, message: emptyMessage(deviceName) };
      return { type: "read" as const, ...menu(programs, deviceName, "הבחירה לא קיימת") };
    }
    const enabled = !item.enabled;
    await upsertProgram({ ...item, enabled });
    void syncTenantPrograms(device.tenantId).catch((error: unknown) => {
      console.error("[pikud] program sync after ivr toggle", error);
    });
    return { type: "say" as const, message: confirmToggle(item, enabled) };
  }

  if (!programs.length) return { type: "say" as const, message: emptyMessage(deviceName) };
  return { type: "read" as const, ...menu(programs, deviceName) };
}

function emptyMessage(deviceName: string) {
  return `ל${deviceName} אין עדיין תוכניות. אפשר להגדיר תוכנית באתר`;
}

function confirmToggle(program: StoredProgram, enabled: boolean) {
  if (!enabled) return `תוכנית ${program.name} כובתה`;
  const when = program.weekdays.length
    ? weekdayPhrase(program.weekdays)
    : program.days.length === 1
      ? "ביום אחד שנבחר"
      : `ב${program.days.length} ימים שנבחרו`;
  return `תוכנית ${program.name} הופעלה, והיא תפעל ${when}`;
}

function menu(programs: Array<{ name: string; enabled: boolean }>, deviceName: string, prefix = "") {
  // One clear sentence per program: number, name, state, then the key.
  const choices = programs
    .map((program, index) => {
      const word = WORDS[index + 1] ?? String(index + 1);
      const state = program.enabled ? "פעילה כעת" : "כבויה כעת";
      return `תוכנית ${word}, ${program.name}, ${state}, להחלפת המצב הקש ${word}`;
    })
    .join(". ");
  const head = prefix
    ? `${prefix}. תפריט תוכניות ל${deviceName}`
    : `תפריט תוכניות ל${deviceName}`;
  return {
    message: `${head}. ${choices}`.replace(/\s+/g, " ").trim(),
    field: "pikud_program" as const,
    min: 1,
    max: 1,
    allowed: programs.map((_, index) => String(index + 1)).join(""),
  };
}
