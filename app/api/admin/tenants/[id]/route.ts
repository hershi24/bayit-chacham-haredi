import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { deleteTenant } from "@/lib/store";

export const runtime = "nodejs";

export function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const { id } = await context.params;
    await deleteTenant(id);
    return Response.json({ ok: true });
  });
}
