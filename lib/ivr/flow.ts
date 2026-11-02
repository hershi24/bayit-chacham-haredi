import type { Connectivity } from "@/lib/types";

export type MenuDevice = {
  deviceId: string;
  name: string;
  relayOn: boolean | null;
  connectivity: Connectivity;
};

export type MenuValues = {
  device?: string;
  action?: string;
  minutes?: string;
  clock?: string;
};

export type MenuRead = {
  type: "read";
  message: string;
  field: "pikud_device" | "pikud_action" | "pikud_minutes" | "pikud_clock";
  min: number;
  max: number;
  allowed?: string;
  mode?: "No" | "Number" | "Time";
};

export type MenuDecision =
  | MenuRead
  | { type: "say"; message: string }
  | { type: "turn"; device: MenuDevice; action: "ON" | "OFF" }
  | { type: "timer"; device: MenuDevice; minutes: number }
  | { type: "clock"; device: MenuDevice; hour: number; minute: number };

const DIGIT_WORD = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];

export function decideMenu(devices: MenuDevice[], values: MenuValues): MenuDecision {
  const listed = devices.slice(0, 9);
  if (!values.device) return deviceList(listed);

  const index = Number(values.device) - 1;
  const device = listed[index];
  if (!device || !Number.isInteger(index)) {
    const again = deviceList(listed);
    return again.type === "read" ? { ...again, message: `הבחירה לא קיימת, ${again.message}` } : again;
  }

  if (!values.action) return deviceMenu(device);

  if (values.action === "1") {
    if (device.relayOn === true) return { ...deviceMenu(device), message: `${label(device)} כבר פועל, ${deviceMenu(device).message}` };
    return { type: "turn", device, action: "ON" };
  }
  if (values.action === "2") {
    if (device.relayOn === false) return { ...deviceMenu(device), message: `${label(device)} כבר כבוי, ${deviceMenu(device).message}` };
    return { type: "turn", device, action: "OFF" };
  }
  if (values.action === "3") {
    if (!values.minutes) {
      return {
        type: "read",
        message: `לכמה דקות להפעיל את ${label(device)}, הקש את מספר הדקות`,
        field: "pikud_minutes",
        min: 1,
        max: 3,
        mode: "Number",
      };
    }
    const minutes = Number(values.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      return {
        type: "read",
        message: "אפשר בין דקה אחת למאתיים וארבעים דקות, הקש שוב את מספר הדקות",
        field: "pikud_minutes",
        min: 1,
        max: 3,
        mode: "Number",
      };
    }
    return { type: "timer", device, minutes };
  }
  if (values.action === "4") {
    if (!values.clock) {
      return {
        type: "read",
        message: `לאיזו שעה להפעיל את ${label(device)}, הקש ארבע ספרות, לדוגמה לשש וחצי בערב הקש אחת שמונה שלוש אפס`,
        field: "pikud_clock",
        min: 4,
        max: 4,
        mode: "Time",
      };
    }
    if (!/^\d{4}$/.test(values.clock)) return clockRetry();
    const hour = Number(values.clock.slice(0, 2));
    const minute = Number(values.clock.slice(2));
    if (hour > 23 || minute > 59) return clockRetry();
    return { type: "clock", device, hour, minute };
  }

  return { ...deviceMenu(device), message: `הבחירה לא קיימת, ${deviceMenu(device).message}` };
}

function deviceList(devices: MenuDevice[]): MenuDecision {
  if (!devices.length) return { type: "say", message: "אין שקעים משויכים" };
  const message = devices.map((device, index) => `ל${label(device)} הקש ${DIGIT_WORD[index + 1]}`).join(", ");
  return {
    type: "read",
    message,
    field: "pikud_device",
    min: 1,
    max: 1,
    allowed: devices.map((_, index) => String(index + 1)).join(""),
    mode: "No",
  };
}

function deviceMenu(device: MenuDevice): MenuRead {
  const name = label(device);
  const offline = device.connectivity === "OFFLINE" ? `${name} אינו מחובר כעת, ` : "";
  if (device.relayOn === true) {
    return {
      type: "read",
      message: `${offline}${name} פועל כעת, לכיבוי הקש שתיים, לטיימר הקש שלוש, לשעון הקש ארבע`,
      field: "pikud_action",
      min: 1,
      max: 1,
      allowed: "234",
      mode: "No",
    };
  }
  if (device.relayOn === false) {
    return {
      type: "read",
      message: `${offline}${name} כבוי כעת, להפעלה הקש אחד, לטיימר הקש שלוש, לשעון הקש ארבע`,
      field: "pikud_action",
      min: 1,
      max: 1,
      allowed: "134",
      mode: "No",
    };
  }
  return {
    type: "read",
    message: `${offline}מצב ${name} אינו ידוע, להפעלה הקש אחד, לכיבוי הקש שתיים, לטיימר הקש שלוש, לשעון הקש ארבע`,
    field: "pikud_action",
    min: 1,
    max: 1,
    allowed: "1234",
    mode: "No",
  };
}

function clockRetry(): MenuRead {
  return {
    type: "read",
    message: "השעה לא תקינה, הקש ארבע ספרות, לדוגמה לשש וחצי בערב הקש אחת שמונה שלוש אפס",
    field: "pikud_clock",
    min: 4,
    max: 4,
    mode: "Time",
  };
}

function label(device: MenuDevice): string {
  const name = device.name.trim();
  return name || device.deviceId;
}
