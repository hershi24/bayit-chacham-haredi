import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { createUser, listUsers } from "@/lib/store";
import { cleanName, cleanPassword, cleanUsername, readJson } from "@/lib/validate";
import { HttpError } from "@/lib/http-error";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    return Response.json({ users: await listUsers() });
  });
}

export function POST(request: Request) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const body = await readJson(request);
    if (body.role !== "admin" && body.role !== "operator") {
      throw new HttpError(400, "תפקיד לא מוכר");
    }
    await createUser({
      username: cleanUsername(body.username),
      name: cleanName(body.name, "שם לתצוגה"),
      password: cleanPassword(body.password),
      role: body.role,
      tenantId: typeof body.tenantId === "string" && body.tenantId ? body.tenantId : null,
    });
    return Response.json({ users: await listUsers() }, { status: 201 });
  });
}
