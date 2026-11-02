import { requireUser, withErrors } from "@/lib/session";
import { listDevices } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const bridge = getBridge();
    if (new URL(request.url).searchParams.get("refresh") === "1") {
      await Promise.all(listDevices(user).map((device) => bridge.refresh(device.deviceId).catch(() => null)));
    }
    return Response.json({ devices: listDevices(user), status: bridge.status() });
  });
}
