import { callerPhone } from "@/lib/caller-phone";
import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { addCallerNumber, listCallerNumbers } from "@/lib/store";
import { cleanOptionalLabel, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const { id } = await context.params;
    const body = await readJson(request);
    await addCallerNumber(id, callerPhone(body.phone), cleanOptionalLabel(body.label));
    return Response.json({ phones: await listCallerNumbers(id) }, { status: 201 });
  });
}
