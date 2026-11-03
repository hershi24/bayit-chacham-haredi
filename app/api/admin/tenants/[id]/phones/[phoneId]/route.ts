import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { listCallerNumbers, removeCallerNumber } from "@/lib/store";

export const runtime = "nodejs";

export function DELETE(_request: Request, context: { params: Promise<{ id: string; phoneId: string }> }) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const { id, phoneId } = await context.params;
    await removeCallerNumber(id, phoneId);
    return Response.json({ phones: await listCallerNumbers(id) });
  });
}
