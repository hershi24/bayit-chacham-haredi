import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { publishDevice } from "@/lib/sse";
import { assertMayUseDevice, getDevice, setDeviceName } from "@/lib/store";
import { cleanName, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    const { deviceId } = await context.params;
    const device = await getDevice(deviceId);
    if (!device) throw new HttpError(404, "השקע לא נמצא");
    await assertMayUseDevice(user, device);
    const body = await readJson(request);
    const name = cleanName(body.name, "כינוי");
    const saved = await setDeviceName(deviceId, name);
    if (!saved) throw new HttpError(404, "השקע לא נמצא");
    publishDevice(saved);
    return Response.json({ device: saved });
  });
}
