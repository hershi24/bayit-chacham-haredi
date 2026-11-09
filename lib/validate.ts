import { isRecord } from "@/lib/wlte/parse";
import { HttpError } from "@/lib/http-error";

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  if (!isRecord(body)) throw new HttpError(400, "גוף הבקשה אינו תקין");
  return body;
}

export function cleanName(value: unknown, label: string) {
  if (typeof value !== "string") throw new HttpError(400, `${label} חסר`);
  const name = value.trim();
  if (name.length < 2 || name.length > 80) throw new HttpError(400, `${label} חייב להכיל 2 עד 80 תווים`);
  return name;
}

export function cleanDeviceId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(value.trim())) {
    throw new HttpError(400, "מזהה שקע חייב להכיל 4 עד 64 תווים באנגלית, ספרות, מקף או קו תחתון");
  }
  return value.trim();
}

export function cleanUsername(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{3,32}$/.test(value.trim())) {
    throw new HttpError(400, "שם משתמש באנגלית, 3 עד 32 תווים");
  }
  return value.trim();
}

export function cleanPassword(value: unknown) {
  if (typeof value !== "string" || value.length < 6 || value.length > 80) {
    throw new HttpError(400, "סיסמה באורך 6 עד 80 תווים");
  }
  return value;
}

export function cleanPhone(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "מספר טלפון אינו תקין");
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new HttpError(400, "מספר טלפון אינו תקין");
  return value.trim();
}

/** Optional nickname for a caller number; empty clears it. */
export function cleanOptionalLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new HttpError(400, "כינוי אינו תקין");
  const label = value.trim();
  if (!label) return null;
  if (label.length > 40) throw new HttpError(400, "כינוי עד 40 תווים");
  return label;
}
