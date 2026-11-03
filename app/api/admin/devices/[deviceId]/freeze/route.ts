import { HttpError } from "@/lib/http-error";
import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { setDeviceFrozen } from "@/lib/store";
import { readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const { deviceId } = await context.params;
    const body = await readJson(request);
    if (typeof body.frozen !== "boolean") throw new HttpError(400, "יש לציין אם להקפיא");
    const device = await setDeviceFrozen(deviceId, body.frozen);
    if (!device) throw new HttpError(404, "השקע לא נמצא");
    return Response.json({ ok: true, device });
  });
}
