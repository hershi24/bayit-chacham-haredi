import type { MenuRead } from "@/lib/ivr/flow";
import {
  askOff,
  askOn,
  confirmToggle,
  detailMenu,
  emptyMessage,
  listMenu,
  noHoursMessage,
  parsePhoneClock,
  pickSlotMenu,
  programSlots,
  slotLabel,
  slotSideMenu,
  slotUpdated,
} from "@/lib/ivr/programs-menu";
import { syncTenantPrograms } from "@/lib/programs/sync";
import type { StoredProgram } from "@/lib/programs/types";
import { getDevice, listPrograms, upsertProgram } from "@/lib/store";

export { programSlots, scheduleSpeech } from "@/lib/ivr/programs-menu";

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
  if (!slots.length) return { type: "say", message: noHoursMessage(program) };

  let slotIndex = 0;
  if (slots.length > 1) {
    if (!input.slot) return pickSlotMenu(program, slots);
    slotIndex = Number(input.slot) - 1;
    if (!slots[slotIndex] || !Number.isInteger(slotIndex)) {
      return pickSlotMenu(program, slots, "הבחירה לא קיימת");
    }
  }

  const slot = slots[slotIndex]!;
  const label = slotLabel(slotIndex);

  if (input.side !== "1" && input.side !== "2") return slotSideMenu(program, slot, slotIndex);

  if (input.side === "1") {
    const on = parsePhoneClock(input.on);
    if (!on) return askOn(input.on ? "השעה לא תקינה, " : `${label}, `);
    await saveSlotTimes(program, slotIndex, on, slot.offTime);
    deferSync(tenantId);
    return { type: "say", message: slotUpdated(program, slotIndex, "on", on) };
  }

  const off = parsePhoneClock(input.off);
  if (!off) return askOff(input.off ? "השעה לא תקינה, " : `${label}, `);
  await saveSlotTimes(program, slotIndex, slot.onTime, off);
  deferSync(tenantId);
  return { type: "say", message: slotUpdated(program, slotIndex, "off", off) };
}

function deferSync(tenantId: string) {
  void syncTenantPrograms(tenantId).catch((error: unknown) => {
    console.error("[pikud] program sync after ivr edit", error);
  });
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
