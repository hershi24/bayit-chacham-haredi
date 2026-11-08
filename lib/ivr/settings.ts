import { normalizePhone } from "@/lib/access";
import { callerPhone } from "@/lib/caller-phone";
import type { MenuRead } from "@/lib/ivr/flow";
import { addAudit, addCallerNumber, listAudit, listCallerNumbers, removeCallerNumber } from "@/lib/store";
import { HttpError } from "@/lib/http-error";
import type { AuditView, CallerNumber } from "@/lib/types";

export type SettingsDecision = MenuRead | { type: "say"; message: string };

const DIGIT = ["אפס", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];
const INDEX = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];

export function speakPhone(phone: string) {
  return normalizePhone(phone)
    .split("")
    .map((digit) => DIGIT[Number(digit)] ?? digit)
    .join(" ");
}

function settingsMenu(): MenuRead {
  return {
    type: "read",
    message: "להוספת מספר מורשה הקש אחד, להסרת מספר הקש שתיים, לשמיעת יומן פעולות הקש שלוש, לפניה למנהל המערכת הקש ארבע",
    field: "pikud_settings",
    min: 1,
    max: 1,
    allowed: "1234",
    mode: "No",
  };
}

function askNewPhone(): MenuRead {
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

function askRemove(phones: CallerNumber[]): SettingsDecision {
  if (phones.length <= 1) {
    return { type: "say", message: "חייבים להשאיר לפחות מספר מורשה אחד, לא ניתן להסיר כעת" };
  }
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

function askAdminConfirm(): MenuRead {
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

function auditSpeech(entry: AuditView) {
  const when = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(entry.at));
  const device = entry.deviceName ? `ב${entry.deviceName}` : "";
  return `${when} ${device} ${auditAction(entry.action)}`.replace(/\s+/g, " ").trim();
}

function auditAction(action: string) {
  if (action === "ON") return "הופעל";
  if (action === "OFF") return "כובה";
  if (action.startsWith("TIMER")) return "טיימר";
  if (action === "ADMIN_REQUEST") return "פניה למנהל";
  if (action.includes("PHONE")) return "עדכון מספר";
  return action;
}

export async function answerSettings(input: {
  tenantId: string;
  actorPhone: string;
  deviceIds?: string[];
  settings?: string;
  newPhone?: string;
  delPhone?: string;
  adminAsk?: string;
}): Promise<SettingsDecision> {
  if (!input.settings && !input.newPhone && !input.delPhone && !input.adminAsk) {
    return settingsMenu();
  }

  if (input.settings === "1" || input.newPhone !== undefined) {
    if (!input.newPhone) return askNewPhone();
    try {
      const phone = callerPhone(input.newPhone);
      await addCallerNumber(input.tenantId, phone);
      await addAudit({
        source: "ivr",
        actor: `טלפון ${normalizePhone(input.actorPhone)}`,
        deviceId: null,
        action: "PHONE_ADD",
        idempotencyKey: null,
        result: "OK",
        detail: phone,
      });
      return { type: "say", message: `המספר ${speakPhone(phone)} נוסף בהצלחה` };
    } catch (error) {
      const message = error instanceof HttpError ? error.message : "הוספת המספר נכשלה";
      return { type: "say", message };
    }
  }

  if (input.settings === "2" || input.delPhone !== undefined) {
    const phones = await listCallerNumbers(input.tenantId);
    if (input.delPhone === undefined) return askRemove(phones);
    if (input.delPhone === "0") return { type: "say", message: "ההסרה בוטלה" };
    const index = Number(input.delPhone) - 1;
    const chosen = phones[index];
    if (!chosen || !Number.isInteger(index)) {
      return { type: "say", message: "הבחירה לא קיימת" };
    }
    if (phones.length <= 1) {
      return { type: "say", message: "חייבים להשאיר לפחות מספר מורשה אחד" };
    }
    await removeCallerNumber(input.tenantId, chosen.id);
    await addAudit({
      source: "ivr",
      actor: `טלפון ${normalizePhone(input.actorPhone)}`,
      deviceId: null,
      action: "PHONE_REMOVE",
      idempotencyKey: null,
      result: "OK",
      detail: chosen.phone,
    });
    return { type: "say", message: `המספר ${speakPhone(chosen.phone)} הוסר` };
  }

  if (input.settings === "3") {
    const owned = new Set(input.deviceIds ?? []);
    const phone = normalizePhone(input.actorPhone);
    const entries = (await listAudit({ role: "admin", tenantId: null }, 40))
      .filter((entry) => {
        if (entry.deviceId && owned.has(entry.deviceId)) return true;
        if (entry.action === "ADMIN_REQUEST" && entry.detail?.includes(input.tenantId)) return true;
        if ((entry.action === "PHONE_ADD" || entry.action === "PHONE_REMOVE") && entry.actor.includes(phone)) return true;
        return false;
      })
      .slice(0, 5);
    if (!entries.length) return { type: "say", message: "אין פעולות ביומן כרגע" };
    const spoken = entries.map((entry) => auditSpeech(entry)).join(", ");
    return { type: "say", message: `פעולות אחרונות, ${spoken}` };
  }

  if (input.settings === "4" || input.adminAsk !== undefined) {
    if (!input.adminAsk) return askAdminConfirm();
    if (input.adminAsk !== "1") return { type: "say", message: "הפניה בוטלה" };
    const phone = normalizePhone(input.actorPhone);
    await addAudit({
      source: "ivr",
      actor: `טלפון ${phone}`,
      deviceId: null,
      action: "ADMIN_REQUEST",
      idempotencyKey: null,
      result: "OPEN",
      detail: `בקשת חזרה מלקוח, טלפון ${phone}, tenant ${input.tenantId}`,
    });
    return { type: "say", message: "הפניה נשלחה למנהל המערכת, נחזור אליכם בהקדם" };
  }

  return { ...settingsMenu(), message: `הבחירה לא קיימת, ${settingsMenu().message}` };
}
