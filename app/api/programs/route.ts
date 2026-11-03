import { randomUUID } from "node:crypto";
import { clampClock } from "@/lib/hebrew/calendar";
import { HttpError } from "@/lib/http-error";
import { programId, syncTenantPrograms } from "@/lib/programs/sync";
import { maxSlots, sortSlots } from "@/lib/programs/slots";
import type { ProgramSlot, StoredProgram } from "@/lib/programs/types";
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

function dayList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, "בחרו ימים");
  const days = [...new Set(value.map((item) => dayString(item)))].sort();
  if (!days.length) throw new HttpError(400, "בחרו לפחות יום אחד");
  if (days.length > 31) throw new HttpError(400, "אפשר עד 31 ימים בתוכנית");
  return days;
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
    } else if (action === "clock-delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) throw new HttpError(400, "חסר שעון");
      await deleteDayClock(tenantId, id);
    } else if (action === "program-save") {
      await saveProgramAction(tenantId, body);
    } else if (action === "program-toggle") {
      const id = typeof body.id === "string" ? body.id : "";
      const current = (await listPrograms(tenantId)).find((program) => program.id === id && program.programKey.startsWith("days:"));
      if (!current) throw new HttpError(404, "התוכנית לא נמצאה");
      await upsertProgram({ ...current, enabled: !current.enabled });
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

async function saveRepeatAction(user: SessionUser, tenantId: string, body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) throw new HttpError(400, "תנו שם לתוכנית");
  const weekdays = cleanWeekdays(Array.isArray(body.weekdays) ? body.weekdays.map((item) => Number(item)) : []);
  if (!weekdays.length) throw new HttpError(400, "בחרו לפחות יום אחד בשבוע");
  const slots = slotList(body);
  const allowed = await tenantDeviceIds(user, tenantId);
  const deviceIds = deviceList(body.deviceIds, allowed);
  if (!deviceIds.length) throw new HttpError(400, "בחרו לפחות שקע אחד");
  const programs = await listPrograms(tenantId);
  const requested = typeof body.id === "string" ? body.id : "";
  const current = requested ? programs.find((program) => program.id === requested && program.programKey.startsWith("days:")) : undefined;
  if (requested && !current) throw new HttpError(404, "התוכנית לא נמצאה");
  const key = current?.programKey ?? `days:${randomUUID()}`;
  await upsertProgram({
    id: current?.id ?? programId(tenantId, key),
    tenantId,
    programKey: key,
    name,
    enabled: current?.enabled ?? true,
    deviceIds,
    startDate: current?.startDate ?? null,
    endDate: current?.endDate ?? null,
    days: current?.days ?? [],
    weekdays,
    onTime: slots[0].onTime,
    offTime: slots[0].offTime,
    slots,
  });
}

function slotList(body: Record<string, unknown>): ProgramSlot[] {
  const raw = Array.isArray(body.slots) ? body.slots : [{ onTime: body.onTime, offTime: body.offTime }];
  const slots = raw
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { onTime: clockTime(record.onTime), offTime: clockTime(record.offTime) };
    })
    .filter((slot) => slot.onTime || slot.offTime);
  if (!slots.length) throw new HttpError(400, "הוסיפו לפחות שעון אחד עם שעת הדלקה או כיבוי");
  if (slots.length > maxSlots) throw new HttpError(400, `אפשר עד ${maxSlots} שעונים בתוכנית`);
  return sortSlots(slots);
}

async function saveProgramAction(tenantId: string, body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) throw new HttpError(400, "חסר שם לתוכנית");
  const days = dayList(body.days);
  const programs = await listPrograms(tenantId);
  const requested = typeof body.id === "string" ? body.id : "";
  const current = requested ? programs.find((program) => program.id === requested && program.programKey.startsWith("days:")) : undefined;
  if (requested && !current) throw new HttpError(404, "התוכנית לא נמצאה");
  const key = current?.programKey ?? `days:${randomUUID()}`;
  const saved: StoredProgram = dated(
    {
      id: current?.id ?? programId(tenantId, key),
      tenantId,
      programKey: key,
      name,
      enabled: current?.enabled ?? true,
      deviceIds: current?.deviceIds ?? [],
      startDate: null,
      endDate: null,
      days,
      weekdays: current?.weekdays ?? [],
      onTime: current?.onTime ?? null,
      offTime: current?.offTime ?? null,
      slots: current?.slots ?? [],
    },
    days,
  );
  await upsertProgram(saved);
  for (const other of programs) {
    if (other.id === saved.id || !other.programKey.startsWith("days:")) continue;
    const next = other.days.filter((day) => !days.includes(day));
    if (next.length !== other.days.length) await upsertProgram(dated(other, next));
  }
  const chosen = new Set(days);
  for (const clock of await listDayClocks(tenantId)) {
    if (chosen.has(clock.day) && clock.programId !== saved.id) {
      await saveDayClock({ ...clock, programId: saved.id });
    } else if (!chosen.has(clock.day) && clock.programId === saved.id) {
      await saveDayClock({ ...clock, programId: null });
    }
  }
}
