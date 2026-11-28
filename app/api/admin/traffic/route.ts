import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { trafficSnapshot } from "@/lib/traffic";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    return Response.json(trafficSnapshot());
  });
}
