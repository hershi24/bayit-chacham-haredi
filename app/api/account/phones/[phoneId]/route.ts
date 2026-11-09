import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { listCallerNumbers, removeCallerNumber, updateCallerNumber } from "@/lib/store";
import { cleanOptionalLabel, readJson } from "@/lib/validate";

export const runtime = "nodejs";

function ownTenant(user: { role: string; tenantId: string | null }) {
  if (user.role !== "operator" || !user.tenantId) throw new HttpError(403, "ניהול המספרים שמור ללקוח");
  return user.tenantId;
}

export function PATCH(request: Request, context: { params: Promise<{ phoneId: string }> }) {
  return withErrors(async () => {
    const tenantId = ownTenant(await requireUser());
    const { phoneId } = await context.params;
    const body = await readJson(request);
    const phone = await updateCallerNumber(tenantId, phoneId, { label: cleanOptionalLabel(body.label) });
    return Response.json({ phone, phones: await listCallerNumbers(tenantId) });
  });
}

export function DELETE(_request: Request, context: { params: Promise<{ phoneId: string }> }) {
  return withErrors(async () => {
    const tenantId = ownTenant(await requireUser());
    const { phoneId } = await context.params;
    await removeCallerNumber(tenantId, phoneId);
    return Response.json({ phones: await listCallerNumbers(tenantId) });
  });
}
