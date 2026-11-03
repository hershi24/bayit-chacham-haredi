import { HttpError } from "@/lib/http-error";
import { requireUser, withErrors } from "@/lib/session";
import { changeOwnPassword } from "@/lib/store";
import { cleanPassword, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function POST(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const body = await readJson(request);
    if (typeof body.currentPassword !== "string" || body.currentPassword === "") {
      throw new HttpError(400, "חסרה הסיסמה הנוכחית");
    }
    await changeOwnPassword(user.id, body.currentPassword, cleanPassword(body.nextPassword));
    return Response.json({ ok: true });
  });
}
