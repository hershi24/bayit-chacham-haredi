import { upcomingPrograms } from "@/lib/hebrew/calendar";
import { syncTenantPrograms } from "@/lib/programs/sync";
import { weekdayPhrase } from "@/lib/programs/weekdays";
import { getClock, getDevice, listPrograms, upsertProgram } from "@/lib/store";

const WORDS = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];

export async function answerPrograms(deviceId: string, digit: string | undefined) {
  const device = await getDevice(deviceId);
  if (!device?.tenantId) return { type: "say" as const, message: "השקע לא נמצא" };
  const programs = (await listPrograms(device.tenantId))
    .filter((program) => program.programKey.startsWith("days:"))
    .slice(0, 8);
  if (digit) {
    const index = Number(digit) - 1;
    const item = programs[index];
    if (!item || !Number.isInteger(index)) {
      const intro = await parshaIntro(device.tenantId);
      if (!programs.length) return { type: "say" as const, message: emptyMessage(intro) };
      return { type: "read" as const, ...menu(programs, intro, "הבחירה לא קיימת") };
    }
    const enabled = !item.enabled;
    await upsertProgram({ ...item, enabled });
    await syncTenantPrograms(device.tenantId);
    const count = item.weekdays.length
      ? weekdayPhrase(item.weekdays)
      : item.days.length === 1
        ? "יום אחד"
        : `${item.days.length} ימים`;
    return { type: "say" as const, message: enabled ? `${item.name} הופעלה, ${count}` : `${item.name} כובתה` };
  }
  const intro = await parshaIntro(device.tenantId);
  if (!programs.length) return { type: "say" as const, message: emptyMessage(intro) };
  return { type: "read" as const, ...menu(programs, intro) };
}

async function parshaIntro(tenantId: string) {
  const settings = await getClock(tenantId);
  const catalog = await upcomingPrograms(settings);
  const windows = catalog.find((item) => item.key === "shabbat")?.windows ?? [];
  const first = windows[0]?.parsha;
  const second = windows[1]?.parsha;
  if (first && second) return `השבת פרשת ${first}, בשבוע שאחריה ${second}`;
  if (first) return `השבת פרשת ${first}`;
  return "";
}

function emptyMessage(intro: string) {
  return `${intro ? `${intro}. ` : ""}אין עדיין תוכניות. בשיחה הבאה, אחרי השקע, לשעון הקש ארבע`.replace(/\s+/g, " ").trim();
}

function menu(
  programs: Array<{ name: string; enabled: boolean }>,
  intro: string,
  prefix = "",
) {
  const choices = programs
    .map((program, index) => `ל${program.name}${program.enabled ? " פעילה" : ""} הקש ${WORDS[index + 1] ?? String(index + 1)}`)
    .join(", ");
  const message = `${prefix ? `${prefix}, ` : ""}${intro ? `${intro}. ` : ""}${choices}`.replace(/\s+/g, " ").trim();
  return {
    message,
    field: "pikud_program" as const,
    min: 1,
    max: 1,
    allowed: programs.map((_, index) => String(index + 1)).join(""),
  };
}
