import { normalizePhone } from "@/lib/access";
import { callerPhone } from "@/lib/caller-phone";
import type { MenuRead } from "@/lib/ivr/flow";
import {
  ADMIN_CANCELLED,
  ADMIN_SENT,
  askAdminConfirm,
  askNewPhone,
  askRemove,
  auditLine,
  auditMessage,
  phoneAdded,
  phoneRemoved,
  REMOVE_CANCELLED,
  settingsMenu,
} from "@/lib/ivr/settings-menu";
import { addAudit, addCallerNumber, listAudit, listCallerNumbers, removeCallerNumber } from "@/lib/store";
import { HttpError } from "@/lib/http-error";

export type SettingsDecision =
  | MenuRead
  | { type: "say"; message: string }
  | { type: "all"; action: "ON" | "OFF" };

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
      return { type: "say", message: phoneAdded(phone) };
    } catch (error) {
      const message = error instanceof HttpError ? error.message : "הוספת המספר נכשלה";
      return { type: "say", message };
    }
  }

  if (input.settings === "2" || input.delPhone !== undefined) {
    const phones = await listCallerNumbers(input.tenantId);
    if (input.delPhone === undefined) return askRemove(phones);
    if (input.delPhone === "0") return { type: "say", message: REMOVE_CANCELLED };
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
    return { type: "say", message: phoneRemoved(chosen.phone) };
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
    return { type: "say", message: auditMessage(entries.map((entry) => auditLine(entry.at, entry.deviceName, entry.action))) };
  }

  if (input.settings === "4" || input.adminAsk !== undefined) {
    if (!input.adminAsk) return askAdminConfirm();
    if (input.adminAsk !== "1") return { type: "say", message: ADMIN_CANCELLED };
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
    return { type: "say", message: ADMIN_SENT };
  }

  if (input.settings === "5") return { type: "all", action: "ON" };
  if (input.settings === "6") return { type: "all", action: "OFF" };

  return { ...settingsMenu(), message: `הבחירה לא קיימת, ${settingsMenu().message}` };
}

export { speakPhone } from "@/lib/ivr/settings-menu";
