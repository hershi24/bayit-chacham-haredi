import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { deleteDevice, getDevice, listDevices, updateDevice } from "@/lib/store";
import { cleanName, readJson } from "@/lib/validate";
import { HttpError } from "@/lib/http-error";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function PATCH(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const { deviceId } = await context.params;
    const body = await readJson(request);
    const current = await getDevice(deviceId);
    if (!current) throw new HttpError(404, "השקע לא נמצא");
    const tenantId =
      typeof body.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : current.tenantId;
    await updateDevice({ deviceId, name: cleanName(body.name, "כינוי"), tenantId });
    return Response.json({ devices: await listDevices(user) });
  });
}

export function DELETE(_request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const { deviceId } = await context.params;
    const removed = await deleteDevice(deviceId);
    for (const id of removed) getBridge().forgetDevice(id);
    return Response.json({ ok: true, removed });
  });
}
