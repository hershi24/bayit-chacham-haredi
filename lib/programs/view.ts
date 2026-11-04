import { hebrewLabels, monthBoard, places } from "@/lib/hebrew/calendar";
import { slotsForWeekday } from "@/lib/programs/slots";
import { coversDay } from "@/lib/programs/span";
import { weekdayOf } from "@/lib/programs/weekdays";
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
      weekdays: [...program.weekdays].sort((left, right) => left - right),
      onTime: program.onTime,
      offTime: program.offTime,
      slots: program.slots,
      deviceIds: program.deviceIds,
      startDate: program.startDate,
      endDate: program.endDate,
      skippedDates: program.skippedDates ?? [],
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "he"));
  const repeated = programs.flatMap((program) =>
    days
      .filter(
        (day) =>
          program.weekdays.includes(weekdayOf(day.date)) &&
          coversDay(day.date, program.startDate, program.endDate) &&
          !(program.skippedDates ?? []).includes(day.date),
      )
      .flatMap((day) =>
        slotsForWeekday(program.slots, weekdayOf(day.date)).map((slot, index) => ({
          id: `week:${program.id}:${day.date}:${index}`,
          day: day.date,
          hebrew: day.hebrew,
          onTime: slot.onTime,
          offTime: slot.offTime,
          deviceIds: program.deviceIds,
          programId: program.id,
          recurring: true,
        })),
      ),
  );
  return {
    tenantId,
    locationId: settings.locationId,
    places: places(),
    devices: devices.map((device) => ({ deviceId: device.deviceId, name: device.name, icon: device.icon })),
    programs,
    clocks: [
      ...clocks.map((clock) => ({
        id: clock.id,
        day: clock.day,
        hebrew: labels[clock.day] ?? "",
        onTime: clock.onTime,
        offTime: clock.offTime,
        deviceIds: clock.deviceIds,
        programId: clock.programId,
        recurring: false,
      })),
      ...repeated,
    ],
    month: { year, month, days },
  };
}
