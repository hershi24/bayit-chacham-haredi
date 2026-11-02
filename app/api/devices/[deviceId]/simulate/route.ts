import { HttpError } from "@/lib/http-error";
import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { getDevice } from "@/lib/store";
import { readJson } from "@/lib/validate";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const { deviceId } = await context.params;
    if (!(await getDevice(deviceId))) throw new HttpError(404, "השקע לא נמצא");
    const body = await readJson(request);
    const relayOn = typeof body.relayOn === "boolean" ? body.relayOn : undefined;
    const online = typeof body.online === "boolean" ? body.online : undefined;
    if (relayOn === undefined && online === undefined) {
      throw new HttpError(400, "חסר מצב לדימוי");
    }
    await getBridge().simulate(deviceId, { relayOn, online });
    const device = await getDevice(deviceId);
    return Response.json({ device });
  });
}
