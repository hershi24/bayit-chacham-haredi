import { callerPhone } from "@/lib/caller-phone";
import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { addCallerNumber, listCallerNumbers } from "@/lib/store";
import { cleanOptionalLabel, readJson } from "@/lib/validate";

export const runtime = "nodejs";

function ownTenant(user: { role: string; tenantId: string | null }) {
  if (user.role !== "operator" || !user.tenantId) throw new HttpError(403, "ניהול המספרים שמור ללקוח");
  return user.tenantId;
}

export function GET() {
  return withErrors(async () => {
    const tenantId = ownTenant(await requireUser());
    return Response.json({ phones: await listCallerNumbers(tenantId) });
  });
}

export function POST(request: Request) {
  return withErrors(async () => {
    const tenantId = ownTenant(await requireUser());
    const body = await readJson(request);
    const phone = await addCallerNumber(tenantId, callerPhone(body.phone), cleanOptionalLabel(body.label));
    return Response.json({ phone, phones: await listCallerNumbers(tenantId) }, { status: 201 });
  });
}
