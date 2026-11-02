import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { createDevice, listDevices } from "@/lib/store";
import { cleanDeviceId, cleanName, readJson } from "@/lib/validate";
import { HttpError } from "@/lib/http-error";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    return Response.json({ devices: listDevices(user) });
  });
}

export function POST(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const body = await readJson(request);
    if (typeof body.tenantId !== "string" || !body.tenantId) throw new HttpError(400, "יש לבחור לקוח");
    const deviceId = cleanDeviceId(body.deviceId);
    const name = cleanName(body.name, "שם השקע");
    createDevice({ deviceId, name, tenantId: body.tenantId });
    getBridge().registerDevice(deviceId, name);
    return Response.json({ devices: listDevices(user) }, { status: 201 });
  });
}
