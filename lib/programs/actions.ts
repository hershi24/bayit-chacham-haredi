import { shiftDate } from "@/lib/time";

export type ClockAction = {
  action: "ON" | "OFF";
  time: string;
  /** The action happens on the morning after the clock's day. */
  nextDay?: boolean;
};

export const maxClockActions = 8;

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function clockTime(value: unknown): string | null {
  return typeof value === "string" && timePattern.test(value) ? value : null;
}

export function parseActions(raw: unknown): ClockAction[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw || "[]");
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const actions: ClockAction[] = [];
  for (const item of parsed) {
    const record = (item ?? {}) as Record<string, unknown>;
    const time = clockTime(record.time);
    const action = record.action === "OFF" ? "OFF" : record.action === "ON" ? "ON" : null;
    if (!time || !action) continue;
    actions.push({ action, time, ...(record.nextDay === true ? { nextDay: true } : {}) });
    if (actions.length >= maxClockActions) break;
  }
  return actions;
}

/** Explicit actions win. An older clock is still one switch-on and one switch-off, and an earlier off stays next morning. */
export function resolveActions(input: {
  onTime?: string | null;
  offTime?: string | null;
  actions?: ClockAction[] | null;
}): ClockAction[] {
  if (input.actions?.length) return input.actions.slice(0, maxClockActions);
  const onTime = clockTime(input.onTime);
  const offTime = clockTime(input.offTime);
  const actions: ClockAction[] = [];
  if (onTime) actions.push({ action: "ON", time: onTime });
  if (offTime) actions.push({ action: "OFF", time: offTime, ...(onTime && offTime <= onTime ? { nextDay: true } : {}) });
  return actions;
}

export function mirrorTimes(actions: ClockAction[]): { onTime: string | null; offTime: string | null } {
  const onTime = actions.find((step) => step.action === "ON")?.time ?? null;
  const offTime = actions.find((step) => step.action === "OFF")?.time ?? null;
  return { onTime, offTime };
}

export function actionDay(day: string, step: ClockAction) {
  return step.nextDay ? shiftDate(day, 1) : day;
}

export function formatClockActions(input: {
  onTime?: string | null;
  offTime?: string | null;
  actions?: ClockAction[] | null;
}): string {
  const actions = resolveActions(input);
  if (!actions.length) return "";
  if (actions.length === 1) {
    const step = actions[0];
    return `${step.action === "ON" ? "הדלקה" : "כיבוי"} ${step.time}${step.nextDay ? " למחרת" : ""}`;
  }
  const ons = actions.filter((step) => step.action === "ON");
  const offs = actions.filter((step) => step.action === "OFF");
  if (ons.length === 1 && offs.length === 1 && !ons[0].nextDay && (offs[0].nextDay || offs[0].time > ons[0].time)) {
    return `${ons[0].time}–${offs[0].time}${offs[0].nextDay ? " למחרת" : ""}`;
  }
  return actions
    .map((step) => `${step.action === "ON" ? "הדלקה" : "כיבוי"} ${step.time}${step.nextDay ? " למחרת" : ""}`)
    .join(" · ");
}
