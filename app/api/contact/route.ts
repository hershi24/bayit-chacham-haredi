import { addAudit } from "@/lib/store";
import { withErrors } from "@/lib/session";
import { readJson } from "@/lib/validate";
import { HttpError } from "@/lib/http-error";

export const runtime = "nodejs";

const recent = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function throttle(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) throw new HttpError(429, "נשלחו כמה פניות ברצף. אפשר להתקשר אלינו ישירות");
  hits.push(now);
  recent.set(key, hits);
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function POST(request: Request) {
  return withErrors(async () => {
    const body = await readJson(request);
    if (text(body.website, 200)) return Response.json({ ok: true });

    const name = text(body.name, 60);
    const phone = text(body.phone, 20).replace(/[^\d+]/g, "");
    const message = text(body.message, 600);
    if (name.length < 2) throw new HttpError(400, "נשמח לשם, כדי שנדע למי לחזור");
    if (!/^\+?\d{9,13}$/.test(phone)) throw new HttpError(400, "מספר הטלפון לא נראה תקין");

    throttle(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local");

    await addAudit({
      source: "web",
      actor: `פניה מהאתר: ${name}`,
      deviceId: null,
      action: "CONTACT_REQUEST",
      idempotencyKey: null,
      result: "OPEN",
      detail: message ? `טלפון ${phone} · ${message}` : `טלפון ${phone}`,
    });
    return Response.json({ ok: true });
  });
}
