import { requireUser, withErrors } from "@/lib/session";
import { setUserEmail } from "@/lib/store";
import { cleanEmail, readJson } from "@/lib/validate";

export const runtime = "nodejs";

export function POST(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    const body = await readJson(request);
    const email = body.email == null || body.email === "" ? null : cleanEmail(body.email);
    await setUserEmail(user.id, email);
    return Response.json({ email });
  });
}
