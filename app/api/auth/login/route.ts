import { establishSession, withErrors } from "@/lib/session";
import { readJson } from "@/lib/validate";
import { HttpError } from "@/lib/http-error";

export const runtime = "nodejs";

export function POST(request: Request) {
  return withErrors(async () => {
    const body = await readJson(request);
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      throw new HttpError(400, "חסרים פרטי התחברות");
    }
    const user = await establishSession(body.username, body.password);
    return Response.json({ user });
  });
}
