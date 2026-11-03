import { randomUUID } from "node:crypto";
import type { PhoneClockPlan } from "@/lib/ivr/flow";
import { programId, syncTenantPrograms } from "@/lib/programs/sync";
import { weekdayPhrase } from "@/lib/programs/weekdays";
import { getDevice, listPrograms, saveDayClock, upsertProgram } from "@/lib/store";

export async function savePhoneClock(plan: PhoneClockPlan): Promise<string> {
  const stored = await getDevice(plan.device.deviceId);
  if (!stored?.tenantId) return "השקע לא נמצא";
  const tenantId = stored.tenantId;
  const deviceIds = plan.devices.map((device) => device.deviceId);
  const times = spokenTimes(plan.onTime, plan.offTime);
  if (plan.day) {
    await saveDayClock({
      id: `clk_${randomUUID()}`,
      tenantId,
      programId: null,
      day: plan.day,
      onTime: plan.onTime,
      offTime: plan.offTime,
      deviceIds,
    });
    await syncTenantPrograms(tenantId);
    return `נשמר שעון ל${spokenDevices(plan)}, בתאריך ${spokenDate(plan.day)}, ${times}`;
  }

  const name = programName(plan).slice(0, 40);
  const programs = await listPrograms(tenantId);
  const existing = programs.find((item) => item.programKey.startsWith("days:") && item.name === name && item.weekdays.length > 0);
  const key = existing?.programKey ?? `days:${randomUUID()}`;
  await upsertProgram({
    id: existing?.id ?? programId(tenantId, key),
    tenantId,
    programKey: key,
    name,
    enabled: true,
    deviceIds,
    startDate: existing?.startDate ?? null,
    endDate: existing?.endDate ?? null,
    days: existing?.days ?? [],
    weekdays: plan.weekdays,
    onTime: plan.onTime,
    offTime: plan.offTime,
  });
  await syncTenantPrograms(tenantId);
  return `נשמרה תוכנית ${name}, ${times}`;
}

function programName(plan: PhoneClockPlan): string {
  const who = plan.devices.length > 1 ? "כל השקעים" : plan.device.name.trim() || "שקע";
  return `${who} ${weekdayPhrase(plan.weekdays)}`.trim();
}

function spokenDevices(plan: PhoneClockPlan): string {
  return plan.devices.map((device) => device.name.trim() || device.deviceId).join(" ו");
}

function spokenDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day} ${month} ${year}`;
}

function spokenTimes(onTime: string | null, offTime: string | null): string {
  const parts = [];
  if (onTime) parts.push(`הדלקה ${onTime}`);
  if (offTime) parts.push(`כיבוי ${offTime}`);
  if (onTime && offTime && offTime <= onTime) parts.push("הכיבוי למחרת");
  return parts.join(", ");
}
