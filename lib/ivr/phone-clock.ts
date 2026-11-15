import { randomUUID } from "node:crypto";
import { clockSavedMessage, phoneClockProgramName, type PhoneClockPlan } from "@/lib/ivr/flow";
import { programId, syncTenantPrograms } from "@/lib/programs/sync";
import { getDevice, listPrograms, saveDayClock, upsertProgram } from "@/lib/store";

export async function savePhoneClock(plan: PhoneClockPlan): Promise<string> {
  const stored = await getDevice(plan.device.deviceId);
  if (!stored?.tenantId) return "השקע לא נמצא";
  const tenantId = stored.tenantId;
  const deviceIds = plan.devices.map((device) => device.deviceId);
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
    return clockSavedMessage(plan);
  }

  const name = phoneClockProgramName(plan);
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
    slots: [{ onTime: plan.onTime, offTime: plan.offTime }],
  });
  await syncTenantPrograms(tenantId);
  return clockSavedMessage(plan);
}
