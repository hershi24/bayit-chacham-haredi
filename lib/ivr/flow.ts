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
  repeat?: string;
  week?: string;
  date?: string;
  on?: string;
  off?: string;
  sockets?: string;
};

export type MenuRead = {
  type: "read";
  message: string;
  field: "pikud_device" | "pikud_action" | "pikud_minutes" | "pikud_repeat" | "pikud_week" | "pikud_date" | "pikud_on" | "pikud_off" | "pikud_sockets";
  min: number;
  max: number;
  allowed?: string;
  mode?: "No" | "Number" | "Time";
  seconds?: number;
};

export type PhoneClockPlan = {
  type: "clock-save";
  device: MenuDevice;
  devices: MenuDevice[];
  day: string | null;
  weekdays: number[];
  onTime: string | null;
  offTime: string | null;
};

export type MenuDecision =
  | MenuRead
  | { type: "say"; message: string }
  | { type: "turn"; device: MenuDevice; action: "ON" | "OFF" }
  | { type: "timer"; device: MenuDevice; minutes: number }
  | PhoneClockPlan;

const DIGIT_WORD = ["", "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];
const REST = "לטיימר הקש שלוש, לשעון הקש ארבע, לתוכניות הקש חמש";

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

  if (values.action === "1") return { type: "turn", device, action: device.relayOn === true ? "OFF" : "ON" };
  if (values.action === "3") return timerFlow(device, values.minutes);
  if (values.action === "4") return clockFlow(device, listed, values);

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
  const power =
    device.relayOn === true
      ? "פועל כעת, לכיבוי הקש אחד"
      : device.relayOn === false
        ? "כבוי כעת, להפעלה הקש אחד"
        : "מצבו אינו ידוע, להפעלה הקש אחד";
  return {
    type: "read",
    message: `${offline}${name} ${power}, ${REST}`,
    field: "pikud_action",
    min: 1,
    max: 1,
    allowed: "1345",
    mode: "No",
  };
}

function timerFlow(device: MenuDevice, minutesValue: string | undefined): MenuDecision {
  if (!minutesValue) {
    return {
      type: "read",
      message: `לכמה דקות להפעיל את ${label(device)}, הקש את מספר הדקות`,
      field: "pikud_minutes",
      min: 1,
      max: 3,
      mode: "Number",
    };
  }
  const minutes = Number(minutesValue);
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

function clockFlow(device: MenuDevice, devices: MenuDevice[], values: MenuValues): MenuDecision {
  const repeat = values.repeat;
  if (!repeat || !["1", "2", "3", "4"].includes(repeat)) return readRepeat(repeat ? "הבחירה לא קיימת, " : "");

  let weekdays: number[] = [];
  if (repeat === "2") weekdays = [0, 1, 2, 3, 4, 5, 6];
  else if (repeat === "3") weekdays = [0, 1, 2, 3, 4];
  else if (repeat === "4") {
    const parsed = values.week ? parseWeek(values.week) : null;
    if (!parsed) return readWeek(values.week ? "הימים לא תקינים, " : "");
    weekdays = parsed;
  }

  let day: string | null = null;
  if (repeat === "1") {
    day = values.date ? parsePhoneDate(values.date) : null;
    if (!day) return readDate(values.date ? "התאריך לא תקין, " : "");
  }

  if (!values.on) return readOn("");
  const on = parsePhoneClock(values.on);
  if (on == null) return readOn("השעה לא תקינה, ");
  const needsOff = on === "skip";
  if (!values.off) return readOff(needsOff, "");
  const off = parsePhoneClock(values.off);
  if (off == null || (needsOff && off === "skip")) return readOff(needsOff, off == null ? "השעה לא תקינה, " : "בלי הדלקה צריך שעת כיבוי, ");

  if (devices.length > 1) {
    if (!values.sockets || (values.sockets !== "1" && values.sockets !== "2")) {
      return readSockets(values.sockets ? "הבחירה לא קיימת, " : "");
    }
  }
  const chosen = devices.length > 1 && values.sockets === "2" ? devices : [device];
  return {
    type: "clock-save",
    device,
    devices: chosen,
    day,
    weekdays: repeat === "1" ? [] : weekdays,
    onTime: on === "skip" ? null : on,
    offTime: off === "skip" ? null : off,
  };
}

function readRepeat(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשעון חד פעמי הקש אחד, לכל יום הקש שתיים, לכל יום חוץ משישי ושבת הקש שלוש, לבחירת ימים הקש ארבע`,
    field: "pikud_repeat",
    min: 1,
    max: 1,
    allowed: "1234",
    mode: "No",
  };
}

function readWeek(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}הקש את הימים ברצף. אחד ליום ראשון, שתיים לשני, שלוש לשלישי, ארבע לרביעי, חמש לחמישי, שש לשישי, שבע לשבת`,
    field: "pikud_week",
    min: 1,
    max: 7,
    allowed: "1234567",
    mode: "Number",
    seconds: 3,
  };
}

function readDate(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}הקש תאריך בן שמונה ספרות, יום חודש ושנה. לשלושה בנובמבר אלפיים עשרים ושש הקש אפס שלוש אחד אחד שתיים שש`,
    field: "pikud_date",
    min: 8,
    max: 8,
    mode: "Number",
  };
}

function readOn(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשעת הדלקה הקש ארבע ספרות. לעשר בבוקר הקש אחת אפס אפס אפס. בלי הדלקה הקש תשע תשע תשע תשע`,
    field: "pikud_on",
    min: 4,
    max: 4,
    mode: "Number",
  };
}

function readOff(onSkipped: boolean, prefix: string): MenuRead {
  const message = onSkipped
    ? `${prefix}בלי הדלקה צריך שעת כיבוי, הקש ארבע ספרות. לשתים עשרה הקש אחת שתיים אפס אפס`
    : `${prefix}לשעת כיבוי הקש ארבע ספרות. לשתים עשרה הקש אחת שתיים אפס אפס. בלי כיבוי הקש תשע תשע תשע תשע`;
  return {
    type: "read",
    message,
    field: "pikud_off",
    min: 4,
    max: 4,
    mode: "Number",
  };
}

function readSockets(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשמור על השקע הזה הקש אחד, על כל השקעים הקש שתיים`,
    field: "pikud_sockets",
    min: 1,
    max: 1,
    allowed: "12",
    mode: "No",
  };
}

function parseWeek(value: string): number[] | null {
  if (!/^[1-7]+$/.test(value)) return null;
  return [...new Set([...value].map((digit) => Number(digit) - 1))].sort((left, right) => left - right);
}

function parsePhoneDate(value: string): string | null {
  if (!/^\d{8}$/.test(value)) return null;
  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const year = Number(value.slice(4));
  if (year < 2020 || year > 2040) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parsePhoneClock(value: string): string | "skip" | null {
  if (value === "9999") return "skip";
  if (!/^\d{4}$/.test(value)) return null;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2));
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function label(device: MenuDevice): string {
  const name = device.name.trim();
  return name || device.deviceId;
}
