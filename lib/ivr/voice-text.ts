const ON = new Set([
  "תדליק",
  "תדליקו",
  "הדלק",
  "הדלקה",
  "מדליק",
  "מדליקה",
  "מדליקים",
  "תפעיל",
  "תפעילו",
  "הפעל",
  "הפעלה",
  "מפעיל",
  "מפעילה",
  "מפעילים",
  "להדליק",
  "להפעיל",
  "הדליקי",
  "תפעילי",
  "הפעיל",
]);
const OFF = new Set(["תכבה", "תכבו", "כבה", "לכבות", "תכבי", "כיבוי", "מכבה", "מכבים", "מכבות"]);
const FILLER = new Set(["את", "של", "לי", "נא", "בבקשה", "על", "עם", "אני", "רוצה", "עכשיו", "בבקשה", "לי"]);
const SYNONYMS: Record<string, string> = {
  אור: "תאורה",
  אורות: "תאורה",
  מנורה: "תאורה",
  מנורות: "תאורה",
  נורה: "תאורה",
  נורות: "תאורה",
  בוילר: "דוד",
};

export { FILLER, OFF, ON, SYNONYMS };

/** Niqqud and final letters are folded so the same word compares in one form. */
export function foldVoice(text: string): string {
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

export function stemVoice(word: string): string {
  let value = foldVoice(word);
  if (value.startsWith("ו") && value.length > 2) value = value.slice(1);
  if (value.startsWith("ה") && value.length > 2) value = value.slice(1);
  if (value.startsWith("ב") && value.length > 2) value = value.slice(1);
  if (value.startsWith("ל") && value.length > 2) value = value.slice(1);
  return SYNONYMS[value] ?? value;
}

export function voiceWords(text: string): string[] {
  return foldVoice(text).split(" ").filter((word) => word.length > 1);
}

export function voiceAction(text: string): "ON" | "OFF" | "STATUS" | "BOTH" | null {
  const folded = foldVoice(text);
  if (folded.includes("מה המצב") || folded.includes("מה מצבו") || folded.includes("איזה מצב") || /(?:^|\s)מצב(?:\s|$)/.test(folded)) {
    return "STATUS";
  }
  const raw = voiceWords(text);
  const on = raw.some((word) => ON.has(word) || ON.has(stemVoice(word)));
  const off = raw.some((word) => OFF.has(word) || OFF.has(stemVoice(word)));
  if (on && off) return "BOTH";
  if (on) return "ON";
  if (off) return "OFF";
  if (raw.some((word) => word === "טיימר" || stemVoice(word) === "טיימר")) return "ON";
  return null;
}
