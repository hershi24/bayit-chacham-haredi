import { requireUser, withErrors } from "@/lib/session";
import { listAudit, listTenants } from "@/lib/store";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const requested = new URL(request.url).searchParams.get("tenantId")?.trim() || "";
    if (user.role !== "admin") {
      return Response.json({ entries: await listAudit(user) });
    }
    const tenants = await listTenants();
    if (!requested) return Response.json({ entries: null, tenants });
    return Response.json({
      entries: await listAudit(user, 100, requested),
      tenants,
      tenantName: tenants.find((tenant) => tenant.id === requested)?.name ?? null,
    });
  });
}
