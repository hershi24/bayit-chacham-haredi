import { canAccessDevice } from "@/lib/access";
import { isDeviceIcon } from "@/lib/devices/icons";
import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { publishDevice } from "@/lib/sse";
import { getDevice, setDeviceIcon } from "@/lib/store";
import { readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    const { deviceId } = await context.params;
    const device = await getDevice(deviceId);
    if (!device) throw new HttpError(404, "השקע לא נמצא");
    if (!canAccessDevice(user, device.tenantId)) throw new HttpError(403, "אין הרשאה לשקע הזה");
    const body = await readJson(request);
    if (!isDeviceIcon(body.icon)) throw new HttpError(400, "האייקון לא מוכר");
    const saved = await setDeviceIcon(deviceId, body.icon);
    if (!saved) throw new HttpError(404, "השקע לא נמצא");
    publishDevice(saved);
    return Response.json({ device: saved });
  });
}
