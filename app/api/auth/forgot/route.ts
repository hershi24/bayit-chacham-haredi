import { requestOrigin } from "@/lib/auth/google";
import { HttpError } from "@/lib/http-error";
import { mailConfigured, sendPasswordReset } from "@/lib/mail";
import { withErrors } from "@/lib/session";
import { findUserForLogin, findUserIdByEmail, getUserEmail, issuePasswordReset } from "@/lib/store";
import { cleanEmail, readJson } from "@/lib/validate";

export const runtime = "nodejs";

const recent = new Map<string, number[]>();

function throttle(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((at) => now - at < 15 * 60 * 1000);
  if (hits.length >= 5) throw new HttpError(429, "יותר מדי בקשות. נסו שוב בעוד כמה דקות");
  hits.push(now);
  recent.set(key, hits);
}

export function POST(request: Request) {
  return withErrors(async () => {
    const body = await readJson(request);
    const raw = typeof body.username === "string" ? body.username.trim() : "";
    if (!raw) throw new HttpError(400, "הקלידו שם משתמש או דוא״ל");
    throttle(raw.toLowerCase());

    if (!mailConfigured()) {
      return Response.json({
        ok: true,
        sent: false,
        message: "שליחת דוא״ל עדיין לא הוגדרה בשרת. פנו למנהל לאיפוס הסיסמה.",
      });
    }

    const email = raw.includes("@") ? cleanEmail(raw) : null;
    const userId = email ? await findUserIdByEmail(email) : (await findUserForLogin(raw))?.id ?? null;
    const destination = userId ? (email ?? (await getUserEmail(userId))) : null;
    if (userId && destination) {
      const token = await issuePasswordReset(userId);
      const url = `${requestOrigin(request)}/login/reset?token=${token}`;
      await sendPasswordReset(destination, url);
    }
    return Response.json({
      ok: true,
      sent: true,
      message: "אם לחשבון יש דוא״ל שמור, נשלח אליו קישור לאיפוס. הוא תקף לחצי שעה.",
    });
  });
}
