import { randomUUID } from "node:crypto";
import { clampClock } from "@/lib/hebrew/calendar";
import { HttpError } from "@/lib/http-error";
import { mergeVisibleDevices } from "@/lib/programs/devices";
import { programId, syncTenantPrograms } from "@/lib/programs/sync";
import { maxDayClocks, maxProgramDays, maxSlots, sortSlots } from "@/lib/programs/slots";
import type { DayClock, ProgramSlot, StoredProgram } from "@/lib/programs/types";
import { cleanWeekdays } from "@/lib/programs/weekdays";
import { programsPayload } from "@/lib/programs/view";
import { requireUser, withErrors } from "@/lib/session";
import {
  deleteDayClock,
  deleteProgram,
  getClock,
  listDayClocks,
  listPrograms,
  listTenantDevices,
  listTenants,
  visibleDeviceIds,
  saveClock,
  saveDateProgram,
  saveDayClock,
  upsertProgram,
} from "@/lib/store";
import type { SessionUser } from "@/lib/types";

export const runtime = "nodejs";

function tenantOf(user: SessionUser, requested: unknown) {
  if (user.role !== "admin") {
    if (!user.tenantId) throw new HttpError(403, "אין לקוח משויך");
    return user.tenantId;
  }
  if (typeof requested !== "string" || !requested.trim()) throw new HttpError(400, "בחרו לקוח");
  return requested.trim();
}

async function tenantDeviceIds(user: SessionUser, tenantId: string) {
  const ids = (await listTenantDevices(tenantId)).map((device) => device.deviceId);
  if (user.role === "admin") return ids;
  const granted = await visibleDeviceIds(user);
  if (!granted) return ids;
  return ids.filter((id) => granted.includes(id));
}

function deviceList(value: unknown, allowed: string[]) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.includes(item)))];
}

function viewed(body: Record<string, unknown>) {
  const year = Number(body.year);
  const month = Number(body.month);
  return {
    year: Number.isInteger(year) ? year : undefined,
    month: Number.isInteger(month) ? month : undefined,
  };
}

function dayString(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "התאריך לא תקין");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, "התאריך לא תקין");
  }
  return value;
}

function clockTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "השעה לא תקינה");
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  if (!match) throw new HttpError(400, "השעה לא תקינה");
  return `${match[1]}:${match[2]}`;
}

function dated(program: StoredProgram, days: string[]): StoredProgram {
  return { ...program, days, startDate: days[0] ?? null, endDate: days[days.length - 1] ?? null };
}

export function GET(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    if (user.role === "admin" && !url.searchParams.get("tenantId")) {
      return Response.json({ tenants: await listTenants(), programs: null });
    }
    const tenantId = tenantOf(user, user.role === "admin" ? url.searchParams.get("tenantId") : user.tenantId);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    return Response.json(
      await presentPrograms(user, tenantId, {
        year: Number.isInteger(year) ? year : undefined,
        month: Number.isInteger(month) ? month : undefined,
      }),
    );
  });
}

export function POST(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new HttpError(400, "בקשה לא תקינה");
    const tenantId = tenantOf(user, user.role === "admin" ? body.tenantId : user.tenantId);
    const action = body.action;

    if (action === "location") {
      const current = await getClock(tenantId);
      await saveClock(tenantId, clampClock({ ...current, locationId: typeof body.locationId === "string" ? body.locationId : "" }));
    } else if (action === "clock-save") {
      await saveClockAction(user, tenantId, body);
    } else if (action === "repeat-save") {
      await saveRepeatAction(user, tenantId, body);
      await dropLooseClock(tenantId, body);
    } else if (action === "clock-delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) throw new HttpError(400, "חסר שעון");
      await deleteDayClock(tenantId, id);
    } else if (action === "program-save") {
      await saveProgramAction(user, tenantId, body);
      await dropLooseClock(tenantId, body);
    } else if (action === "program-toggle") {
      const id = typeof body.id === "string" ? body.id : "";
      const current = (await listPrograms(tenantId)).find((program) => program.id === id && program.programKey.startsWith("days:"));
      if (!current) throw new HttpError(404, "התוכנית לא נמצאה");
      await upsertProgram({ ...current, enabled: !current.enabled });
    } else if (action === "program-skip") {
      const id = typeof body.id === "string" ? body.id : "";
      const current = (await listPrograms(tenantId)).find((program) => program.id === id && program.programKey.startsWith("days:"));
      if (!current) throw new HttpError(404, "התוכנית לא נמצאה");
      await upsertProgram({ ...current, skippedDates: skippedList(body.skippedDates) });
    } else if (action === "program-delete") {
      const id = typeof body.id === "string" ? body.id : "";
      const current = (await listPrograms(tenantId)).find((program) => program.id === id && program.programKey.startsWith("days:"));
      if (!current) throw new HttpError(404, "התוכנית לא נמצאה");
      await deleteProgram(tenantId, current.id);
    } else {
      throw new HttpError(400, "פעולה לא מוכרת");
    }

    await syncTenantPrograms(tenantId);
    return Response.json(await presentPrograms(user, tenantId, viewed(body)));
  });
}

async function presentPrograms(user: SessionUser, tenantId: string, when?: { year?: number; month?: number }) {
  const payload = await programsPayload(tenantId, when);
  if (user.role !== "admin") {
    const allowed = new Set(await tenantDeviceIds(user, tenantId));
    payload.devices = payload.devices.filter((device) => allowed.has(device.deviceId));
  }
  return payload;
}

async function saveClockAction(user: SessionUser, tenantId: string, body: Record<string, unknown>) {
  const day = dayString(body.day);
  const onTime = clockTime(body.onTime);
  const offTime = clockTime(body.offTime);
  if (!onTime && !offTime) throw new HttpError(400, "בחרו שעת הדלקה או כיבוי");
  const allowed = await tenantDeviceIds(user, tenantId);
  const deviceIds = deviceList(body.deviceIds, allowed);
  if (!deviceIds.length) throw new HttpError(400, "בחרו לפחות שקע אחד");
  const programs = await listPrograms(tenantId);
  const requested = typeof body.programId === "string" ? body.programId : "";
  const program = requested ? programs.find((item) => item.id === requested && item.programKey.startsWith("days:")) : undefined;
  if (requested && !program) throw new HttpError(400, "התוכנית לא נמצאה");
  const id = typeof body.id === "string" && body.id ? body.id : `clk_${randomUUID()}`;
  if (body.id) {
    const existing = (await listDayClocks(tenantId)).some((clock) => clock.id === id);
    if (!existing) throw new HttpError(404, "השעון לא נמצא");
  }
  if (program && !program.days.includes(day)) {
    const days = [...program.days, day].sort();
    await upsertProgram(dated(program, days));
  }
  for (const other of programs) {
    if (!program || other.id === program.id || !other.programKey.startsWith("days:") || !other.days.includes(day)) continue;
    await upsertProgram(dated(other, other.days.filter((item) => item !== day)));
  }
  await saveDayClock({
    id,
    tenantId,
    programId: program?.id ?? null,
    day,
    onTime,
    offTime,
    deviceIds,
  });
}

function optionalDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  return dayString(value);
}

function enabledFlag(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function skippedList(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "רשימת התאריכים לא תקינה");
  const days = [...new Set(value.map((item) => dayString(item)))];
  if (days.length > 120) throw new HttpError(400, "אפשר להשהות עד 120 תאריכים");
  return days.sort();
}

async function dropLooseClock(tenantId: string, body: Record<string, unknown>) {
  const id = typeof body.replaceClockId === "string" ? body.replaceClockId : "";
  if (!id) return;
  const clock = (await listDayClocks(tenantId)).find((item) => item.id === id);
  if (clock && !clock.programId) await deleteDayClock(tenantId, id);
}

async function saveRepeatAction(user: SessionUser, tenantId: string, body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) throw new HttpError(400, "תנו שם לתוכנית");
  const startDate = optionalDate(body.startDate);
  const endDate = optionalDate(body.endDate);
  if (startDate && endDate && endDate < startDate) throw new HttpError(400, "תאריך הסיום מוקדם מתאריך ההתחלה");
  const slots = slotList(body);
  const weekdays = cleanWeekdays([
    ...(Array.isArray(body.weekdays) ? body.weekdays.map((item) => Number(item)) : []),
    ...slots.flatMap((slot) => slot.weekdays ?? []),
  ]);
  if (!weekdays.length) throw new HttpError(400, "בחרו לפחות יום אחד בשבוע");
  const allowed = await tenantDeviceIds(user, tenantId);
  const deviceIds = deviceList(body.deviceIds, allowed);
  if (!deviceIds.length) throw new HttpError(400, "בחרו לפחות שקע אחד");
  const programs = await listPrograms(tenantId);
  const requested = typeof body.id === "string" ? body.id : "";
  const current = requested ? programs.find((program) => program.id === requested && program.programKey.startsWith("days:")) : undefined;
  if (requested && !current) throw new HttpError(404, "התוכנית לא נמצאה");
  const key = current?.programKey ?? `days:${randomUUID()}`;
  const savedId = current?.id ?? programId(tenantId, key);
  await upsertProgram({
    id: savedId,
    tenantId,
    programKey: key,
    name,
    enabled: enabledFlag(body.enabled, current?.enabled ?? true),
    deviceIds,
    startDate,
    endDate,
    days: [],
    weekdays,
    onTime: slots[0].onTime,
    offTime: slots[0].offTime,
    slots,
    skippedDates: current?.skippedDates ?? [],
  });
  const absorb = Array.isArray(body.absorbIds) ? body.absorbIds.filter((item): item is string => typeof item === "string") : [];
  for (const id of absorb) {
    if (id === savedId) continue;
    const other = programs.find((program) => program.id === id && program.programKey.startsWith("days:"));
    if (!other || other.days.length || !other.weekdays.length) continue;
    if (!other.weekdays.every((day) => weekdays.includes(day))) continue;
    await deleteProgram(tenantId, other.id);
  }
  if (current) {
    const owned = (await listDayClocks(tenantId)).filter((clock) => clock.programId === current.id);
    for (const clock of owned) await deleteDayClock(tenantId, clock.id);
  }
}

function slotList(body: Record<string, unknown>): ProgramSlot[] {
  const raw = Array.isArray(body.slots) ? body.slots : [{ onTime: body.onTime, offTime: body.offTime }];
  const slots = raw
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return {
        onTime: clockTime(record.onTime),
        offTime: clockTime(record.offTime),
        weekdays: cleanWeekdays(Array.isArray(record.weekdays) ? record.weekdays.map((item) => Number(item)) : []),
      };
    })
    .filter((slot) => slot.onTime || slot.offTime);
  if (!slots.length) throw new HttpError(400, "הוסיפו לפחות שעון אחד עם שעת הדלקה או כיבוי");
  if (slots.length > maxSlots) throw new HttpError(400, `אפשר עד ${maxSlots} שעונים בתוכנית`);
  return sortSlots(slots);
}

function clockKey(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!id || id.length > 80 || !/^[\w:-]+$/.test(id)) return "";
  return id;
}

function datePlan(body: Record<string, unknown>) {
  if (!Array.isArray(body.days) || !body.days.length) throw new HttpError(400, "בחרו לפחות יום אחד");
  if (body.days.length > maxProgramDays) throw new HttpError(400, `אפשר עד ${maxProgramDays} ימים בתוכנית`);
  const seen = new Set<string>();
  const days = body.days.map((item) => {
    const record = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const day = dayString(record.date ?? record.day);
    if (seen.has(day)) throw new HttpError(400, "אי אפשר לבחור את אותו תאריך פעמיים");
    seen.add(day);
    if (!Array.isArray(record.clocks) || !record.clocks.length) {
      throw new HttpError(400, "הוסיפו לפחות שעון אחד עם שעת הדלקה או כיבוי");
    }
    if (record.clocks.length > maxDayClocks) throw new HttpError(400, `אפשר עד ${maxDayClocks} שעונים ביום`);
    const clocks = record.clocks.map((entry) => {
      const row = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const onTime = clockTime(row.onTime);
      const offTime = clockTime(row.offTime);
      if (!onTime && !offTime) throw new HttpError(400, "בחרו שעת הדלקה או כיבוי");
      return { id: clockKey(row.id), onTime, offTime };
    });
    return { day, clocks };
  });
  days.sort((left, right) => left.day.localeCompare(right.day));
  return days;
}

async function saveProgramAction(user: SessionUser, tenantId: string, body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) throw new HttpError(400, "תנו שם לתוכנית");
  const plan = datePlan(body);
  const allowed = await tenantDeviceIds(user, tenantId);
  const chosen = deviceList(body.deviceIds, allowed);
  if (!chosen.length) throw new HttpError(400, "בחרו לפחות שקע אחד");
  const programs = await listPrograms(tenantId);
  const requested = typeof body.id === "string" ? body.id : "";
  const current = requested ? programs.find((program) => program.id === requested && program.programKey.startsWith("days:")) : undefined;
  if (requested && !current) throw new HttpError(404, "התוכנית לא נמצאה");
  const owned = current ? (await listDayClocks(tenantId)).filter((clock) => clock.programId === current.id) : [];
  const deviceIds = mergeVisibleDevices(
    chosen,
    [...(current?.deviceIds ?? []), ...owned.flatMap((clock) => clock.deviceIds)],
    allowed,
  );
  const key = current?.programKey ?? `days:${randomUUID()}`;
  const savedId = current?.id ?? programId(tenantId, key);
  const days = plan.map((item) => item.day);
  const clocks: DayClock[] = plan.flatMap((item) =>
    item.clocks.map((clock) => ({
      id: clock.id,
      tenantId,
      programId: savedId,
      day: item.day,
      onTime: clock.onTime,
      offTime: clock.offTime,
      deviceIds,
    })),
  );
  await saveDateProgram(
    dated(
      {
        id: savedId,
        tenantId,
        programKey: key,
        name,
        enabled: enabledFlag(body.enabled, current?.enabled ?? true),
        deviceIds,
        startDate: null,
        endDate: null,
        days,
        weekdays: [],
        onTime: null,
        offTime: null,
        slots: [],
        skippedDates: current?.skippedDates ?? [],
      },
      days,
    ),
    clocks,
  );
}
