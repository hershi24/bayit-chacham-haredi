import { hebrewLabels, monthBoard, places } from "@/lib/hebrew/calendar";
import { getClock, listDayClocks, listPrograms, listTenantDevices } from "@/lib/store";

export async function programsPayload(
  tenantId: string,
  when?: { year?: number; month?: number },
  now = new Date(),
) {
  const settings = await getClock(tenantId);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const today = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = when?.year && when.year >= 2020 && when.year <= 2040 ? when.year : Number(today.year);
  const month = when?.month && when.month >= 1 && when.month <= 12 ? when.month : Number(today.month);
  const [stored, clocks, devices, days] = await Promise.all([
    listPrograms(tenantId),
    listDayClocks(tenantId),
    listTenantDevices(tenantId),
    monthBoard(settings.locationId, year, month),
  ]);
  const labels = await hebrewLabels(clocks.map((clock) => clock.day));
  const programs = stored
    .filter((program) => program.programKey.startsWith("days:"))
    .map((program) => ({
      id: program.id,
      name: program.name,
      enabled: program.enabled,
      days: [...program.days].sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "he"));
  return {
    tenantId,
    locationId: settings.locationId,
    places: places(),
    devices: devices.map((device) => ({ deviceId: device.deviceId, name: device.name })),
    programs,
    clocks: clocks.map((clock) => ({
      id: clock.id,
      day: clock.day,
      hebrew: labels[clock.day] ?? "",
      onTime: clock.onTime,
      offTime: clock.offTime,
      deviceIds: clock.deviceIds,
      programId: clock.programId,
    })),
    month: { year, month, days },
  };
}
