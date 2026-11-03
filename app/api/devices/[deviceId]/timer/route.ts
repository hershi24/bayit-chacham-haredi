import { timerInstants, timerMessage } from "@/lib/devices/timer";
import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { publishDevice } from "@/lib/sse";
import { assertMayUseDevice, getDevice, presentDevice, saveSchedule } from "@/lib/store";
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
    if (body.mode !== "now" && body.mode !== "later") {
      throw new HttpError(400, "בחרו אם להפעיל עכשיו או מאוחר יותר");
    }
    const minutes = typeof body.minutes === "number" ? body.minutes : Number(body.minutes);
    let instants;
    try {
      instants = timerInstants({
        minutes,
        start: body.mode === "now" ? "now" : typeof body.time === "string" ? body.time : "",
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "הטיימר לא תקין");
    }

    let saved = true;
    let message: string;
    if (body.mode === "now") {
      if (device.connectivity === "OFFLINE") throw new HttpError(400, "השקע אינו מחובר כעת");
      const result = await getBridge().command({
        deviceId,
        action: "ON",
        source: "web",
        actor: user.name,
      });
      saved = result.status === "SUCCESS" || result.status === "SENT";
      if (saved) await saveSchedule({ deviceId, kind: "timer_off", runAt: instants.offAt });
      message = saved
        ? timerMessage({ mode: "now", minutes, onAt: null, offAt: instants.offAt })
        : "השקע לא אושר כפועל, ולכן הטיימר לא נשמר";
    } else {
      if (!instants.onAt) throw new HttpError(400, "השעה אינה תקינה");
      await saveSchedule({ deviceId, kind: "later_on", runAt: instants.onAt });
      await saveSchedule({ deviceId, kind: "timer_off", runAt: instants.offAt });
      message = timerMessage({ mode: "later", minutes, onAt: instants.onAt, offAt: instants.offAt });
    }

    const fresh = await getDevice(deviceId);
    if (!fresh) throw new HttpError(404, "השקע לא נמצא");
    const view = presentDevice(fresh);
    publishDevice(view);
    return Response.json({ device: view, saved, message });
  });
}
