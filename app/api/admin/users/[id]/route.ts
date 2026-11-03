import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { deleteUser, updateUser } from "@/lib/store";
import { cleanName, cleanPassword, readJson } from "@/lib/validate";
import { HttpError } from "@/lib/http-error";

export const runtime = "nodejs";

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const actor = await requireUser();
    requireAdmin(actor);
    const { id } = await context.params;
    const body = await readJson(request);
    if (body.role !== "admin" && body.role !== "operator") throw new HttpError(400, "תפקיד לא מוכר");
    const password = body.password == null || body.password === "" ? null : cleanPassword(body.password);
    let deviceIds: string[] | null = null;
    if (body.role === "operator" && body.deviceIds != null) {
      if (!Array.isArray(body.deviceIds)) throw new HttpError(400, "רשימת השקעים אינה תקינה");
      deviceIds = [...new Set(body.deviceIds.filter((item): item is string => typeof item === "string" && item.trim() !== ""))];
    }
    await updateUser({
      id,
      actorId: actor.id,
      name: cleanName(body.name, "שם לתצוגה"),
      role: body.role,
      tenantId: typeof body.tenantId === "string" && body.tenantId ? body.tenantId : null,
      password,
      deviceIds,
    });
    return Response.json({ ok: true });
  });
}

export function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const { id } = await context.params;
    await deleteUser(id, user.id);
    return Response.json({ ok: true });
  });
}
