import { normalizePhone } from "@/lib/access";
import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { createTenant, listTenants } from "@/lib/store";
import { cleanName, cleanPhone, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    return Response.json({ tenants: listTenants() });
  });
}

export function POST(request: Request) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const body = await readJson(request);
    const phone = cleanPhone(body.phone);
    const tenant = createTenant({
      name: cleanName(body.name, "שם הלקוח"),
      phone: phone ? normalizePhone(phone) : null,
    });
    return Response.json({ tenant }, { status: 201 });
  });
}
