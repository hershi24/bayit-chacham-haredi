import type { MenuDevice } from "@/lib/ivr/flow";
import { speechFor } from "@/lib/ivr/speech";

export type VoiceCommand =
  | { kind: "on"; device: MenuDevice }
  | { kind: "off"; device: MenuDevice }
  | { kind: "timer"; device: MenuDevice; minutes: number }
  | { kind: "status"; device: MenuDevice }
  | { kind: "clarify"; speech: string };

const ON = new Set(["תדליק", "הדלק", "תפעיל", "הפעל", "להדליק", "להפעיל", "הדליקי", "תפעילי", "הפעיל"]);
const OFF = new Set(["תכבה", "כבה", "לכבות", "תכבי", "כיבוי"]);
const FILLER = new Set(["את", "של", "לי", "נא", "בבקשה", "על", "עם", "אני", "רוצה", "עכשיו", "בבקשה", "לי"]);
const GENERIC = new Set(["שקע", "ערוץ", "התקן", "מכשיר"]);
const SYNONYMS: Record<string, string> = {
  אור: "תאורה",
  אורות: "תאורה",
  מנורה: "תאורה",
  מנורות: "תאורה",
  נורה: "תאורה",
  נורות: "תאורה",
  בוילר: "דוד",
};

const MINUTE_WORDS: Record<string, number> = {
  אחת: 1,
  אחד: 1,
  שתיים: 2,
  שניים: 2,
  שלוש: 3,
  ארבע: 4,
  חמש: 5,
  שש: 6,
  שבע: 7,
  שמונה: 8,
  תשע: 9,
  עשר: 10,
  עשרים: 20,
  שלושים: 30,
  ארבעים: 40,
  חמישים: 50,
};

function fold(text: string): string {
  return text
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ץ/g, "צ")
    .replace(/ף/g, "פ")
    .replace(/ך/g, "כ")
    .replace(/[^\u0590-\u05FF0-9a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(word: string): string {
  let value = fold(word);
  if (value.startsWith("ו") && value.length > 2) value = value.slice(1);
  if (value.startsWith("ה") && value.length > 2) value = value.slice(1);
  if (value.startsWith("ב") && value.length > 2) value = value.slice(1);
  if (value.startsWith("ל") && value.length > 2) value = value.slice(1);
  return SYNONYMS[value] ?? value;
}

function rawWords(text: string): string[] {
  return fold(text).split(" ").filter((word) => word.length > 1);
}

function words(text: string): string[] {
  return rawWords(text).map((word) => stem(word)).filter((word) => word.length > 1);
}

function isGroup(text: string): boolean {
  const folded = fold(text);
  return /(?:^|\s)הכל(?:\s|$)/.test(folded) || folded.includes("כולם") || folded.includes("כולן") || folded.includes("כל ה");
}

function minutesOf(text: string): number | null {
  const folded = fold(text);
  if (folded.includes("שעתיים") || folded.includes("שתי שעות")) return 120;
  if (folded.includes("חצי שעה")) return 30;
  if (folded.includes("רבע שעה")) return 15;
  if (/(?:^|\s)שעה(?:\s|$)/.test(folded) || folded.includes("לשעה")) return 60;
  const digits = folded.match(/(\d+)\s*(?:דקות|דקה)/);
  if (digits) return Number(digits[1]);
  if (!folded.includes("דקות") && !folded.includes("דקה")) return null;
  for (const [word, minutes] of Object.entries(MINUTE_WORDS)) {
    if (folded.includes(word)) return minutes;
  }
  return null;
}

function actionOf(text: string): "ON" | "OFF" | "STATUS" | "BOTH" | null {
  const folded = fold(text);
  if (folded.includes("מה המצב") || folded.includes("מה מצבו") || folded.includes("איזה מצב") || /(?:^|\s)מצב(?:\s|$)/.test(folded)) {
    return "STATUS";
  }
  const raw = rawWords(text);
  const on = raw.some((word) => ON.has(word) || ON.has(stem(word)));
  const off = raw.some((word) => OFF.has(word) || OFF.has(stem(word)));
  if (on && off) return "BOTH";
  if (on) return "ON";
  if (off) return "OFF";
  if (raw.some((word) => word === "טיימר" || stem(word) === "טיימר")) return "ON";
  return null;
}

function deviceTokens(name: string): string[] {
  return words(name).filter((token) => !FILLER.has(token) && !ON.has(token) && !OFF.has(token));
}

function scoreDevice(device: MenuDevice, spoken: Set<string>): number {
  const tokens = deviceTokens(device.name);
  const specific = tokens.filter((token) => !GENERIC.has(token));
  const wanted = specific.length ? specific : tokens;
  if (!wanted.length) return 0;
  return wanted.filter((token) => spoken.has(token)).length;
}

/**
 * Map a Hebrew sentence onto one of this caller's devices.
 * A tie, a missing name, or a group phrase stays unresolved.
 */
export function parseVoiceCommand(transcript: string, devices: MenuDevice[]): VoiceCommand {
  const text = transcript.trim();
  if (!text) return { kind: "clarify", speech: "לא שמעתי פקודה. אמור את שם ההתקן ואת הפעולה" };
  if (isGroup(text)) {
    return { kind: "clarify", speech: "פקודה לכל ההתקנים בדיבור לא מופעלת. אמור התקן אחד" };
  }

  const action = actionOf(text);
  if (action === "BOTH") return { kind: "clarify", speech: "לא הבנתי אם להדליק או לכבות. אמור שוב" };

  const spoken = new Set<string>();
  for (const word of rawWords(text)) {
    const token = stem(word);
    if (FILLER.has(word) || FILLER.has(token) || ON.has(word) || ON.has(token) || OFF.has(word) || OFF.has(token)) continue;
    if (token === "טיימר" || token === "מצב" || token === "מה") continue;
    if (token.length > 1) spoken.add(token);
  }
  const ranked = devices
    .map((device) => ({ device, score: scoreDevice(device, spoken) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.device.name.localeCompare(right.device.name, "he"));

  const best = ranked[0];
  if (!best) {
    return action
      ? { kind: "clarify", speech: "לא הבנתי איזה התקן. אמור את השם שמופיע בתפריט" }
      : { kind: "clarify", speech: "לא הבנתי את הפקודה. אמור הדלקה או כיבוי ואת שם ההתקן" };
  }
  if (ranked[1] && ranked[1].score === best.score) {
    const names = ranked
      .filter((item) => item.score === best.score)
      .slice(0, 3)
      .map((item) => item.device.name)
      .join(", ");
    return { kind: "clarify", speech: `יש כמה התקנים מתאימים: ${names}. אמור את השם המדויק` };
  }
  if (!action) return { kind: "clarify", speech: `לא הבנתי אם להדליק או לכבות את ${best.device.name}` };

  if (action === "STATUS") return { kind: "status", device: best.device };
  if (action === "OFF") return { kind: "off", device: best.device };

  const minutes = minutesOf(text);
  if (minutes == null) return { kind: "on", device: best.device };
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
    return { kind: "clarify", speech: "אפשר בין דקה אחת למאתיים וארבעים דקות" };
  }
  return { kind: "timer", device: best.device, minutes };
}

/** Words for a command that does not switch a relay: a question, or a state check. */
export function voiceCheckSpeech(command: VoiceCommand): string {
  if (command.kind === "clarify") return command.speech;
  if (command.kind === "status") {
    return speechFor({ kind: "status", relayOn: command.device.relayOn, name: command.device.name });
  }
  return speechFor({ kind: "failed" });
}
