import { clearSession, withErrors } from "@/lib/session";

export const runtime = "nodejs";

export function POST() {
  return withErrors(async () => {
    await clearSession();
    return Response.json({ ok: true });
  });
}
