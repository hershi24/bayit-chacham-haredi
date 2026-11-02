import { customWindow, places, upcomingAgenda, upcomingPrograms, type ClockSettings, type ProgramWindow } from "@/lib/hebrew/calendar";
import { getClock, listPrograms, listTenantDevices } from "@/lib/store";

export type ProgramCard = {
  id: string | null;
  key: string;
  name: string;
  blurb: string;
  enabled: boolean;
  custom: boolean;
  deviceIds: string[];
  startDate: string | null;
  endDate: string | null;
  windows: ProgramWindow[];
};

export async function programsPayload(tenantId: string, now = new Date()) {
  const settings = await getClock(tenantId);
  const stored = await listPrograms(tenantId);
  const devices = await listTenantDevices(tenantId);
  const catalog = await upcomingPrograms(settings, now);
  const cards: ProgramCard[] = catalog.map((item) => {
    const saved = stored.find((program) => program.programKey === item.key);
    return {
      id: saved?.id ?? null,
      key: item.key,
      name: item.name,
      blurb: item.blurb,
      enabled: saved?.enabled ?? false,
      custom: false,
      deviceIds: saved?.deviceIds ?? [],
      startDate: null,
      endDate: null,
      windows: item.windows,
    };
  });
  for (const program of stored) {
    if (!program.programKey.startsWith("custom:") || !program.startDate || !program.endDate) continue;
    const window = await customWindow(program.name, program.startDate, program.endDate, settings, now);
    cards.push({
      id: program.id,
      key: program.programKey,
      name: program.name,
      blurb: "תוכנית שבניתם לפי תאריכים",
      enabled: program.enabled,
      custom: true,
      deviceIds: program.deviceIds,
      startDate: program.startDate,
      endDate: program.endDate,
      windows: window ? [window] : [],
    });
  }
  return {
    tenantId,
    settings,
    places: places(),
    devices: devices.map((device) => ({ deviceId: device.deviceId, name: device.name })),
    programs: cards,
    agenda: (await upcomingAgenda(settings, now)).slice(0, 18),
    parshiot: (catalog.find((item) => item.key === "shabbat")?.windows ?? []).slice(0, 4),
  };
}

export function previewCustom(name: string, startDate: string, endDate: string, settings: ClockSettings, now = new Date()) {
  return customWindow(name, startDate, endDate, settings, now);
}
