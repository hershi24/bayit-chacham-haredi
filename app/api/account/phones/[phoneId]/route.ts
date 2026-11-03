import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { listCallerNumbers, removeCallerNumber } from "@/lib/store";

export const runtime = "nodejs";

export function DELETE(_request: Request, context: { params: Promise<{ phoneId: string }> }) {
  return withErrors(async () => {
    const user = await requireUser();
    if (user.role !== "operator" || !user.tenantId) throw new HttpError(403, "ניהול המספרים שמור ללקוח");
    const { phoneId } = await context.params;
    await removeCallerNumber(user.tenantId, phoneId);
    return Response.json({ phones: await listCallerNumbers(user.tenantId) });
  });
}
