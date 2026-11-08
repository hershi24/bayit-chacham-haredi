import type { Connectivity } from "@/lib/types";
import { israelDate } from "@/lib/time";

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
  side?: string;
  on?: string;
  off?: string;
  more?: string;
  sockets?: string;
};

export type MenuRead = {
  type: "read";
  message: string;
  field:
    | "pikud_device"
    | "pikud_action"
    | "pikud_minutes"
    | "pikud_repeat"
    | "pikud_week"
    | "pikud_date"
    | "pikud_side"
    | "pikud_on"
    | "pikud_off"
    | "pikud_more"
    | "pikud_sockets"
    | "pikud_settings"
    | "pikud_new_phone"
    | "pikud_del_phone"
    | "pikud_admin_ask";
  min: number;
  max: number;
  allowed?: string;
  mode?: "No" | "Number" | "Time" | "Digits" | "Date";
  seconds?: number;
  allowEmpty?: boolean;
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
  if (values.action === "2") return timerFlow(device, values.minutes);
  if (values.action === "3") return clockFlow(device, listed, values);

  return { ...deviceMenu(device), message: `הבחירה לא קיימת, ${deviceMenu(device).message}` };
}

function deviceList(devices: MenuDevice[]): MenuDecision {
  if (!devices.length) return { type: "say", message: "אין שקעים משויכים" };
  const sockets = devices.map((device, index) => `ל${label(device)} הקש ${DIGIT_WORD[index + 1]}`).join(", ");
  return {
    type: "read",
    message: `${sockets}, להגדרות הקש אפס`,
    field: "pikud_device",
    min: 1,
    max: 1,
    allowed: `0${devices.map((_, index) => String(index + 1)).join("")}`,
    mode: "No",
  };
}

function deviceMenu(device: MenuDevice): MenuRead {
  const name = label(device);
  const offline = device.connectivity === "OFFLINE" ? `${name} אינו מחובר כעת, ` : "";
  const onNow = device.relayOn === true;
  const state = onNow ? "פועל כעת" : device.relayOn === false ? "כבוי כעת" : "מצבו אינו ידוע";
  const first = onNow ? "לכיבוי הקש אחד" : "להפעלה הקש אחד";
  return {
    type: "read",
    message: `${offline}${name} ${state}, ${first}, לטיימר הקש שתיים, לשעון הקש שלוש, לתוכניות הקש ארבע`,
    field: "pikud_action",
    min: 1,
    max: 1,
    allowed: "1234",
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
  if (!repeat || !["1", "2", "3", "4", "5"].includes(repeat)) return readRepeat(repeat ? "הבחירה לא קיימת, " : "");

  let weekdays: number[] = [];
  if (repeat === "3") weekdays = [0, 1, 2, 3, 4, 5, 6];
  else if (repeat === "4") weekdays = [0, 1, 2, 3, 4];
  else if (repeat === "5") {
    const parsed = values.week ? parseWeek(values.week) : null;
    if (!parsed) return readWeek(values.week ? "הימים לא תקינים, " : "");
    weekdays = parsed;
  }

  let day: string | null = null;
  let heard = "";
  if (repeat === "1") {
    day = israelDate();
    heard = `שעון להיום, ${spokenDateWords(day)}, `;
  } else if (repeat === "2") {
    if (!values.date) return readDate(values.date === "" ? "לא הוקש תאריך, " : "");
    const parsed = parsePhoneDate(values.date);
    if (!parsed.iso) return readDate(`${parsed.reason}, `);
    day = parsed.iso;
    heard = `${spokenCapturedDate(day)}, `;
  }

  const side = values.side;
  if (side !== "1" && side !== "2") return readSide(side ? "הבחירה לא קיימת, " : heard);

  if (side === "1") {
    const on = clockTime(values.on, readOn);
    if (typeof on !== "string") return on;
    if (values.more !== "1" && values.more !== "2") return readContinue("off", values.more ? "הבחירה לא קיימת, " : heardOn(on));
    if (values.more === "2") return commitClock(device, devices, values, day, weekdays, on, null);
    const off = clockTime(values.off, readOff);
    if (typeof off !== "string") return off;
    return commitClock(device, devices, values, day, weekdays, on, off);
  }

  const off = clockTime(values.off, readOff);
  if (typeof off !== "string") return off;
  if (values.more !== "1" && values.more !== "2") return readContinue("on", values.more ? "הבחירה לא קיימת, " : heardOff(off));
  if (values.more === "2") return commitClock(device, devices, values, day, weekdays, null, off);
  const on = clockTime(values.on, readOn);
  if (typeof on !== "string") return on;
  return commitClock(device, devices, values, day, weekdays, on, off);
}

function heardOn(clock: string): string {
  return `נקלטה שעת הדלקה ${spokenClockTime(clock)}, `;
}

function heardOff(clock: string): string {
  return `נקלטה שעת כיבוי ${spokenClockTime(clock)}, `;
}

function commitClock(
  device: MenuDevice,
  devices: MenuDevice[],
  values: MenuValues,
  day: string | null,
  weekdays: number[],
  onTime: string | null,
  offTime: string | null,
): MenuDecision {
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
    weekdays: day ? [] : weekdays,
    onTime,
    offTime,
  };
}

function readRepeat(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשעון להיום הקש אחד, לתאריך מסוים הקש שתיים, לכל יום הקש שלוש, לכל יום חוץ משישי ושבת הקש ארבע, לבחירת ימים הקש חמש`,
    field: "pikud_repeat",
    min: 1,
    max: 1,
    allowed: "12345",
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
    message: `${prefix}הקש שמונה ספרות, שתיים ליום, שתיים לחודש, וארבע ספרות לשנה. לשלושה בנובמבר אלפיים עשרים ושש הקש אפס שלוש אחד אחד שתיים אפס שתיים שש`,
    field: "pikud_date",
    min: 8,
    max: 8,
    // playback No stays silent. Number would speak the buffer as a number and drop a leading zero.
    // Capture is min and max, both 8, so 03112026 still arrives. confirm is already no.
    mode: "No",
    seconds: 8,
    allowEmpty: true,
  };
}

function readSide(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}להגדרת הדלקה הקש אחד, להגדרת כיבוי הקש שתיים`,
    field: "pikud_side",
    min: 1,
    max: 1,
    allowed: "12",
    mode: "No",
  };
}

function readContinue(next: "on" | "off", prefix: string): MenuRead {
  const message =
    next === "off"
      ? `${prefix}להמשך להגדרת כיבוי הקש אחד, לסיום הקש שתיים`
      : `${prefix}להמשך להגדרת הדלקה הקש אחד, לסיום הקש שתיים`;
  return {
    type: "read",
    message,
    field: "pikud_more",
    min: 1,
    max: 1,
    allowed: "12",
    mode: "No",
  };
}

function readOn(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשעת הדלקה הקש ארבע ספרות. לעשר בבוקר הקש אחת אפס אפס אפס`,
    field: "pikud_on",
    min: 4,
    max: 4,
    mode: "No",
  };
}

function readOff(prefix: string): MenuRead {
  return {
    type: "read",
    message: `${prefix}לשעת כיבוי הקש ארבע ספרות. לשתים עשרה הקש אחת שתיים אפס אפס`,
    field: "pikud_off",
    min: 4,
    max: 4,
    mode: "No",
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

function parsePhoneDate(value: string): { iso: string; reason?: undefined } | { iso?: undefined; reason: string } {
  if (!/^\d{8}$/.test(value)) return { reason: "חסרות ספרות, צריך שמונה ספרות יום חודש ושנה" };
  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const year = Number(value.slice(4));
  if (month < 1 || month > 12) return { reason: "החודש לא תקין" };
  if (year < 2020 || year > 2040) return { reason: "השנה לא תקינה" };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { reason: "היום לא קיים בחודש הזה" };
  }
  return { iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

function clockTime(value: string | undefined, ask: (prefix: string) => MenuRead): string | MenuRead {
  if (!value) return ask("");
  const parsed = parsePhoneClock(value);
  if (!parsed) return ask("השעה לא תקינה, ");
  return parsed;
}

function parsePhoneClock(value: string): string | null {
  if (!/^\d{4}$/.test(value)) return null;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2));
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const MONTH_IN = [
  "",
  "בינואר",
  "בפברואר",
  "במרץ",
  "באפריל",
  "במאי",
  "ביוני",
  "ביולי",
  "באוגוסט",
  "בספטמבר",
  "באוקטובר",
  "בנובמבר",
  "בדצמבר",
];
const WEEKDAYS = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const MASCULINE = ["", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה"];
const FEMININE = ["", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];

export function spokenDateWords(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${spokenCount(day, "m")} ${MONTH_IN[month]} ${spokenYear(year)}, ${WEEKDAYS[weekday]}`;
}

function spokenCapturedDate(iso: string): string {
  return `נקלט ${spokenDateWords(iso)}`;
}

export function spokenClockTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const words = spokenHour(hour);
  const part = clockPart(hour);
  if (minute === 0) return `${words} ${part}`;
  if (minute === 30) return `${words} וחצי ${part}`;
  if (minute === 15) return `${words} ורבע ${part}`;
  return `${words} ו${spokenCount(minute, "f")} ${part}`;
}

function spokenHour(hour: number): string {
  const hour12 = hour % 12;
  if (hour12 === 0) return "שתים עשרה";
  if (hour12 === 10) return "עשר";
  if (hour12 === 11) return "אחת עשרה";
  return FEMININE[hour12] ?? "";
}

function clockPart(hour: number): string {
  if (hour >= 5 && hour < 12) return "בבוקר";
  if (hour >= 12 && hour < 17) return "בצהריים";
  if (hour >= 17 && hour < 21) return "בערב";
  return "בלילה";
}

function spokenYear(year: number): string {
  if (year >= 2000 && year < 2100) {
    const rest = year - 2000;
    return rest ? `אלפיים ${spokenCount(rest, "f")}` : "אלפיים";
  }
  return String(year);
}

function spokenCount(value: number, gender: "m" | "f"): string {
  const ones = gender === "m" ? MASCULINE : FEMININE;
  if (value < 10) return ones[value] ?? "";
  if (value === 10) return gender === "m" ? "עשרה" : "עשר";
  if (value < 20) {
    if (gender === "m" && value === 12) return "שנים עשר";
    return `${ones[value - 10] ?? ""} ${gender === "m" ? "עשר" : "עשרה"}`;
  }
  const tens = ["", "", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"];
  const ten = tens[Math.floor(value / 10)] ?? "";
  const unit = value % 10;
  if (!unit) return ten;
  return `${ten} ו${ones[unit] ?? ""}`;
}

function label(device: MenuDevice): string {
  const name = device.name.trim();
  return name || device.deviceId;
}
