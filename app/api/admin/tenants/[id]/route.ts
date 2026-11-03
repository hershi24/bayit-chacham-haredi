import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { deleteTenant, renameTenant } from "@/lib/store";
import { cleanName, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const { id } = await context.params;
    const body = await readJson(request);
    await renameTenant(id, cleanName(body.name, "שם הלקוח"));
    return Response.json({ ok: true });
  });
}

export function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const { id } = await context.params;
    await deleteTenant(id);
    return Response.json({ ok: true });
  });
}
