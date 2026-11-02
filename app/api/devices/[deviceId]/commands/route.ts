import { canAccessDevice } from "@/lib/access";
import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { getDevice } from "@/lib/store";
import { readJson } from "@/lib/validate";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    const { deviceId } = await context.params;
    const device = getDevice(deviceId);
    if (!device) throw new HttpError(404, "השקע לא נמצא");
    if (!canAccessDevice(user, device.tenantId)) throw new HttpError(403, "אין הרשאה לשקע הזה");
    const body = await readJson(request);
    if (body.action !== "ON" && body.action !== "OFF") {
      throw new HttpError(400, "הפעולה חייבת להיות ON או OFF");
    }
    const result = await getBridge().command({
      deviceId,
      action: body.action,
      source: "web",
      actor: user.name,
    });
    return Response.json(result);
  });
}
