import { HttpError } from "@/lib/http-error";
import { withErrors } from "@/lib/session";
import { consumePasswordReset, replacePassword } from "@/lib/store";
import { cleanPassword, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function POST(request: Request) {
  return withErrors(async () => {
    const body = await readJson(request);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) throw new HttpError(400, "הקישור לא תקין");
    const password = cleanPassword(body.password);
    const userId = await consumePasswordReset(token);
    if (!userId) throw new HttpError(400, "הקישור פג או שכבר נוצל. בקשו קישור חדש");
    await replacePassword(userId, password);
    return Response.json({ ok: true });
  });
}
