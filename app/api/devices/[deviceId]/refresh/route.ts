import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { assertMayUseDevice, getDevice } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function POST(_request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    const { deviceId } = await context.params;
    const device = await getDevice(deviceId, { plans: false });
    if (!device) throw new HttpError(404, "השקע לא נמצא");
    await assertMayUseDevice(user, device);
    await getBridge().refresh(deviceId, false);
    const next = await getDevice(deviceId);
    if (!next) throw new HttpError(404, "השקע לא נמצא");
    return Response.json({ device: next });
  });
}
