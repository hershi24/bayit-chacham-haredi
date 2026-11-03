import { normalizePhone } from "@/lib/access";
import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { createCustomer, createTenant, listTenants } from "@/lib/store";
import { cleanName, cleanPassword, cleanPhone, cleanUsername, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    return Response.json({ tenants: await listTenants() });
  });
}

export function POST(request: Request) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const body = await readJson(request);
    const phone = cleanPhone(body.phone);
    const name = cleanName(body.name, "שם הלקוח");
    const normalized = phone ? normalizePhone(phone) : null;
    if (typeof body.username === "string" && body.username.trim() !== "") {
      await createCustomer({
        name,
        username: cleanUsername(body.username),
        password: cleanPassword(body.password),
        phone: normalized,
      });
      return Response.json({ tenants: await listTenants() }, { status: 201 });
    }
    const tenant = await createTenant({ name, phone: normalized });
    return Response.json({ tenant }, { status: 201 });
  });
}
