import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { listDevices, saveDeviceOrder } from "@/lib/store";
import { readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function POST(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const body = await readJson(request);
    const deviceIds = Array.isArray(body.deviceIds)
      ? body.deviceIds.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    if (!deviceIds.length) throw new HttpError(400, "חסרה רשימת התקנים");

    let tenantId = user.tenantId;
    if (user.role === "admin") {
      const fromBody = typeof body.tenantId === "string" ? body.tenantId : "";
      if (fromBody) tenantId = fromBody;
      else {
        const board = await listDevices(user);
        const first = board.find((device) => deviceIds.includes(device.deviceId));
        tenantId = first?.tenantId ?? null;
      }
    }
    if (!tenantId) throw new HttpError(400, "חסר לקוח");

    const devices = await saveDeviceOrder(tenantId, deviceIds);
    return Response.json({ devices });
  });
}
