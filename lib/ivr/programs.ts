import { customWindow, formatClock, upcomingPrograms, type ProgramWindow } from "@/lib/hebrew/calendar";
import { programId, syncTenantPrograms } from "@/lib/programs/sync";
import type { StoredProgram } from "@/lib/programs/types";
import { getClock, getDevice, listPrograms, upsertProgram } from "@/lib/store";

const WORDS = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];

type PhoneItem = {
  key: string;
  name: string;
  enabled: boolean;
  days: number;
  intro: string;
  when: string;
};

export async function answerPrograms(deviceId: string, digit: string | undefined) {
  const device = await getDevice(deviceId);
  if (!device?.tenantId) return { type: "say" as const, message: "השקע לא נמצא" };
  const settings = await getClock(device.tenantId);
  const stored = await listPrograms(device.tenantId);
  const items = await phoneItems(settings, stored);
  if (!digit) return { type: "read" as const, ...menu(items) };
  const index = Number(digit) - 1;
  const item = items[index];
  if (!item || !Number.isInteger(index)) return { type: "read" as const, ...menu(items, "הבחירה לא קיימת") };
  const current = stored.find((program) => program.programKey === item.key);
  const enabled = !(current?.enabled ?? false);
  await upsertProgram({
    id: current?.id ?? programId(device.tenantId, item.key),
    tenantId: device.tenantId,
    programKey: item.key,
    name: item.name,
    enabled,
    deviceIds: current?.deviceIds ?? [],
    startDate: current?.startDate ?? null,
    endDate: current?.endDate ?? null,
  });
  await syncTenantPrograms(device.tenantId);
  const days = item.days === 2 ? "ליומיים" : item.days > 1 ? `ל${item.days} ימים` : "";
  if (!enabled) return { type: "say" as const, message: `${item.name} כובתה` };
  return {
    type: "say" as const,
    message: `${item.name} נבנתה ${days}. ${item.when}`.replace(/\s+/g, " ").trim(),
  };
}

async function phoneItems(settings: Awaited<ReturnType<typeof getClock>>, stored: StoredProgram[]): Promise<PhoneItem[]> {
  const catalog = await upcomingPrograms(settings);
  const presets = catalog
    .filter((item) => item.key === "shabbat" || item.windows.length > 0)
    .slice(0, 7)
    .map((item) => toItem(item.key, item.name, item.windows[0], item.windows, stored));
  const room = 8 - presets.length;
  const customs: PhoneItem[] = [];
  for (const program of stored.filter((item) => item.programKey.startsWith("custom:") && item.startDate && item.endDate).slice(0, room)) {
    const window = await customWindow(program.name, program.startDate!, program.endDate!, settings);
    customs.push(toItem(program.programKey, program.name, window ?? undefined, window ? [window] : [], stored));
  }
  return [...presets, ...customs];
}

function toItem(
  key: string,
  name: string,
  window: ProgramWindow | undefined,
  windows: ProgramWindow[],
  stored: StoredProgram[],
): PhoneItem {
  const saved = stored.find((program) => program.programKey === key);
  const parshiot = windows
    .map((item) => item.parsha)
    .filter((parsha): parsha is string => Boolean(parsha))
    .slice(0, 3);
  const intro =
    parshiot.length >= 2
      ? `השבת פרשת ${parshiot[0]}, בשבוע שאחריה ${parshiot[1]}${parshiot[2] ? `, ואחריה ${parshiot[2]}` : ""}`
      : "";
  const when = window
    ? `${window.title}, כניסה בשעה ${formatClock(window.start)}, יציאה בשעה ${formatClock(window.end)}`
    : "";
  return {
    key,
    name,
    enabled: saved?.enabled ?? false,
    days: window?.days ?? 1,
    intro,
    when,
  };
}

function menu(items: PhoneItem[], prefix = "") {
  const shabbat = items.find((item) => item.key === "shabbat");
  const heard = shabbat?.intro ? `${shabbat.intro}. ` : "";
  const choices = items
    .map((item, index) => {
      const state = item.enabled ? " פעילה" : "";
      return `ל${item.name}${state} הקש ${WORDS[index + 1]}`;
    })
    .join(", ");
  const message = `${prefix ? `${prefix}, ` : ""}${heard}${choices}`.replace(/\s+/g, " ").trim();
  return {
    message,
    field: "pikud_program" as const,
    min: 1,
    max: 1,
    allowed: items.map((_, index) => String(index + 1)).join(""),
  };
}
