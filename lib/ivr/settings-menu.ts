import { normalizePhone } from "@/lib/access";
import type { MenuRead } from "@/lib/ivr/flow";

const DIGIT = ["אפס", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];
const INDEX = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];

export const ADMIN_SENT = "הפניה נשלחה למנהל המערכת, נחזור אליכם בהקדם";
export const ADMIN_CANCELLED = "הפניה בוטלה";
export const REMOVE_CANCELLED = "ההסרה בוטלה";
export const KEEP_ONE_PHONE = "חייבים להשאיר לפחות מספר מורשה אחד, לא ניתן להסיר כעת";

export function speakPhone(phone: string) {
  return normalizePhone(phone)
    .split("")
    .map((digit) => DIGIT[Number(digit)] ?? digit)
    .join(" ");
}

export function settingsMenu(): MenuRead {
  return {
    type: "read",
    message:
      "להוספת מספר מורשה הקש אחד, להסרת מספר הקש שתיים, לשמיעת יומן פעולות הקש שלוש, לפניה למנהל המערכת הקש ארבע, להפעלת כל השקעים הקש חמש, לכיבוי כל השקעים הקש שש, לסידור סדר ההתקנים הקש שבע",
    field: "pikud_settings",
    min: 1,
    max: 1,
    allowed: "1234567",
    mode: "No",
  };
}

export function askOrderPick(
  devices: Array<{ name: string }>,
  position: number,
  remainingIndexes: number[],
): MenuRead | { type: "say"; message: string } {
  if (!remainingIndexes.length) return { type: "say", message: "אין התקנים לסידור" };
  const place = INDEX[position] || String(position);
  const choices = remainingIndexes
    .map((index) => `ל${devices[index]?.name || "התקן"} הקש ${INDEX[index + 1]}`)
    .join(", ");
  return {
    type: "read",
    message: `מי יהיה במקום ${place}. ${choices}, להשארת שאר הסדר כמו שהוא הקש אפס`,
    field: `pikud_ord${position}`,
    min: 1,
    max: 1,
    allowed: `0${remainingIndexes.map((index) => String(index + 1)).join("")}`,
    mode: "No",
  };
}

export function orderSaved() {
  return "סדר ההתקנים נשמר. כך הם יופיעו בטלפון ובאתר";
}

export function askNewPhone(): MenuRead {
  return {
    type: "read",
    message: "הקישו את מספר הטלפון להוספה, כולל קידומת אפס",
    field: "pikud_new_phone",
    min: 9,
    max: 10,
    mode: "Digits",
    seconds: 12,
  };
}

export function askRemove(phones: Array<{ phone: string }>): MenuRead | { type: "say"; message: string } {
  if (phones.length <= 1) return { type: "say", message: KEEP_ONE_PHONE };
  const listed = phones.slice(0, 9);
  const choices = listed
    .map((item, index) => `למספר ${speakPhone(item.phone)} הקש ${INDEX[index + 1]}`)
    .join(", ");
  return {
    type: "read",
    message: `${choices}, לביטול הקש אפס`,
    field: "pikud_del_phone",
    min: 1,
    max: 1,
    allowed: `0${listed.map((_, index) => String(index + 1)).join("")}`,
    mode: "No",
  };
}

export function askAdminConfirm(): MenuRead {
  return {
    type: "read",
    message: "לשליחת פניה למנהל המערכת שיחזור אליכם הקש אחד, לביטול הקש שתיים",
    field: "pikud_admin_ask",
    min: 1,
    max: 1,
    allowed: "12",
    mode: "No",
  };
}

export function phoneAdded(phone: string) {
  return `המספר ${speakPhone(phone)} נוסף בהצלחה`;
}

export function phoneRemoved(phone: string) {
  return `המספר ${speakPhone(phone)} הוסר`;
}

export function auditAction(action: string) {
  if (action === "ON") return "הופעל";
  if (action === "OFF") return "כובה";
  if (action.startsWith("TIMER")) return "טיימר";
  if (action === "ADMIN_REQUEST") return "פניה למנהל";
  if (action.includes("PHONE")) return "עדכון מספר";
  return action;
}

export function auditLine(at: string, deviceName: string | null | undefined, action: string) {
  const when = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
  const device = deviceName ? `ב${deviceName}` : "";
  return `${when} ${device} ${auditAction(action)}`.replace(/\s+/g, " ").trim();
}

export function auditMessage(lines: string[]) {
  if (!lines.length) return "אין פעולות ביומן כרגע";
  return `פעולות אחרונות, ${lines.join(", ")}`;
}

export function allIdleMessage(action: "ON" | "OFF", onlyFrozen: boolean) {
  if (onlyFrozen) return "אין שקעים זמינים, כולם מוקפאים";
  return action === "ON" ? "כל השקעים כבר פועלים" : "כל השקעים כבר כבויים";
}

export function allDoneMessage(action: "ON" | "OFF", count: number) {
  const countWord = count === 1 ? "שקע אחד" : count === 2 ? "שני שקעים" : `${count} שקעים`;
  return action === "ON" ? `כל השקעים הופעלו בהצלחה, ${countWord}` : `כל השקעים כובו בהצלחה, ${countWord}`;
}
