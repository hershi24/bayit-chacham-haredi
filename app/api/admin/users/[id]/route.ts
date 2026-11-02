import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { deleteUser } from "@/lib/store";

export const runtime = "nodejs";

export function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const { id } = await context.params;
    deleteUser(id, user.id);
    return Response.json({ ok: true });
  });
}
