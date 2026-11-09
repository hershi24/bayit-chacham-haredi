import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { listCallerNumbers, removeCallerNumber, updateCallerNumber } from "@/lib/store";
import { cleanOptionalLabel, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function PATCH(request: Request, context: { params: Promise<{ id: string; phoneId: string }> }) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const { id, phoneId } = await context.params;
    const body = await readJson(request);
    await updateCallerNumber(id, phoneId, { label: cleanOptionalLabel(body.label) });
    return Response.json({ phones: await listCallerNumbers(id) });
  });
}

export function DELETE(_request: Request, context: { params: Promise<{ id: string; phoneId: string }> }) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const { id, phoneId } = await context.params;
    await removeCallerNumber(id, phoneId);
    return Response.json({ phones: await listCallerNumbers(id) });
  });
}
