import { randomUUID } from "node:crypto";
import { clampClock, customWindow } from "@/lib/hebrew/calendar";
import { programId, syncTenantPrograms } from "@/lib/programs/sync";
import { programsPayload } from "@/lib/programs/view";
import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { deleteProgram, getClock, listPrograms, listTenantDevices, listTenants, saveClock, upsertProgram } from "@/lib/store";
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

function deviceList(value: unknown, allowed: string[]) {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string" && allowed.includes(item));
}

export function GET(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    if (user.role === "admin" && !url.searchParams.get("tenantId")) {
      return Response.json({ tenants: await listTenants(), programs: null });
    }
    const tenantId = tenantOf(user, user.role === "admin" ? url.searchParams.get("tenantId") : user.tenantId);
    return Response.json(await programsPayload(tenantId));
  });
}

export function POST(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new HttpError(400, "בקשה לא תקינה");
    const tenantId = tenantOf(user, user.role === "admin" ? body.tenantId : user.tenantId);
    const devices = await listTenantDevices(tenantId);
    const allowed = devices.map((device) => device.deviceId);
    const action = body.action;

    if (action === "settings") {
      await saveClock(
        tenantId,
        clampClock({
          locationId: typeof body.locationId === "string" ? body.locationId : "",
          startAction: body.startAction === "OFF" ? "OFF" : "ON",
          endAction: body.endAction === "ON" ? "ON" : "OFF",
          startOffsetMin: Number(body.startOffsetMin),
          endOffsetMin: Number(body.endOffsetMin),
        }),
      );
    } else if (action === "toggle" || action === "devices") {
      const key = typeof body.key === "string" ? body.key.trim() : "";
      if (!key) throw new HttpError(400, "חסרה תוכנית");
      const stored = await listPrograms(tenantId);
      const current = stored.find((program) => program.programKey === key);
      const catalog = (await programsPayload(tenantId)).programs.find((program) => program.key === key);
      if (!current && !catalog) throw new HttpError(404, "התוכנית לא נמצאה");
      const deviceIds = body.deviceIds === undefined ? (current?.deviceIds ?? []) : deviceList(body.deviceIds, allowed);
      await upsertProgram({
        id: current?.id ?? programId(tenantId, key),
        tenantId,
        programKey: key,
        name: current?.name ?? catalog?.name ?? "תוכנית",
        enabled: action === "toggle" ? !(current?.enabled ?? false) : (current?.enabled ?? false),
        deviceIds,
        startDate: current?.startDate ?? null,
        endDate: current?.endDate ?? null,
      });
    } else if (action === "create") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
      const startDate = typeof body.startDate === "string" ? body.startDate : "";
      const endDate = typeof body.endDate === "string" ? body.endDate : "";
      if (!name) throw new HttpError(400, "חסר שם לתוכנית");
      const settings = clampClock(await getClock(tenantId));
      const window = await customWindow(name, startDate, endDate, settings);
      if (!window) throw new HttpError(400, "התאריכים לא תקינים. אפשר עד שבועיים");
      const key = `custom:${randomUUID()}`;
      await upsertProgram({
        id: programId(tenantId, key),
        tenantId,
        programKey: key,
        name,
        enabled: true,
        deviceIds: deviceList(body.deviceIds, allowed),
        startDate: startDate <= endDate ? startDate : endDate,
        endDate: startDate <= endDate ? endDate : startDate,
      });
    } else if (action === "delete") {
      const key = typeof body.key === "string" ? body.key : "";
      const stored = (await listPrograms(tenantId)).find((program) => program.programKey === key);
      if (!stored?.programKey.startsWith("custom:")) throw new HttpError(400, "אפשר למחוק רק תוכנית שבניתם");
      await deleteProgram(tenantId, stored.id);
    } else {
      throw new HttpError(400, "פעולה לא מוכרת");
    }

    await syncTenantPrograms(tenantId);
    return Response.json(await programsPayload(tenantId));
  });
}
