import { requireUser, withErrors } from "@/lib/session";
import { listAudit } from "@/lib/store";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    const user = await requireUser();
    return Response.json({ entries: await listAudit(user) });
  });
}
