import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { resetTraffic, trafficSnapshot } from "@/lib/traffic";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    return Response.json(trafficSnapshot());
  });
}

export function POST() {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    resetTraffic();
    return Response.json(trafficSnapshot());
  });
}
