import { requireUser, withErrors } from "@/lib/session";
import { getBridge } from "@/lib/wlte/bridge";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    const user = await requireUser();
    return Response.json({ user, status: getBridge().status() });
  });
}
