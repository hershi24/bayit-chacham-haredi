import { normalizePhone } from "@/lib/access";
import { HttpError } from "@/lib/http-error";
import { cleanPhone } from "@/lib/validate";

export function callerPhone(value: unknown) {
  const phone = cleanPhone(value);
  if (!phone) throw new HttpError(400, "חסר מספר טלפון");
  const normalized = normalizePhone(phone);
  if (normalized.length < 8 || normalized.length > 15) throw new HttpError(400, "מספר טלפון אינו תקין");
  return normalized;
}
