import { requireUser, withErrors } from "@/lib/session";
import { listDevices } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

const REFRESH_BUDGET_MS = 12_000;

export function GET(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const bridge = getBridge();
    let devices = await listDevices(user);
    if (new URL(request.url).searchParams.get("refresh") === "1") {
      // Wait for live reads so the response already carries fresh state (not only SSE later).
      await Promise.allSettled(
        devices.map((device) =>
          Promise.race([
            bridge.refresh(device.deviceId).catch(() => null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), REFRESH_BUDGET_MS)),
          ]),
        ),
      );
      devices = await listDevices(user);
    }
    return Response.json({ devices, status: bridge.status() });
  });
}
