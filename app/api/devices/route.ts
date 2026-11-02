import { requireUser, withErrors } from "@/lib/session";
import { listDevices } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const bridge = getBridge();
    if (new URL(request.url).searchParams.get("refresh") === "1") {
      const current = await listDevices(user);
      await Promise.all(current.map((device) => bridge.refresh(device.deviceId).catch(() => null)));
    }
    return Response.json({ devices: await listDevices(user), status: bridge.status() });
  });
}
