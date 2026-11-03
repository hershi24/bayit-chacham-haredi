import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { assertMayUseDevice, getDevice } from "@/lib/store";
import { readJson } from "@/lib/validate";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    const { deviceId } = await context.params;
    const device = await getDevice(deviceId);
    if (!device) throw new HttpError(404, "השקע לא נמצא");
    await assertMayUseDevice(user, device);
    if (device.frozen) throw new HttpError(403, "השקע מוקפא");
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
