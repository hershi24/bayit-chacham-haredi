import { spokenClockTime } from "@/lib/ivr/flow";
import { foldVoice, voiceAction } from "@/lib/ivr/voice-text";
import { weekdayOf } from "@/lib/programs/weekdays";
import { israelDate, jerusalemInstant, shiftDate } from "@/lib/time";

export type VoiceClock =
  | { ok: true; day: string; onTime: string; offTime: string; dayWord: string }
  | { ok: false; speech: string };

const speak = (value: string) => foldVoice(value);

function foldKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [speak(key), value]));
}

const SCHEDULE_ON = new Set(["שידלק", "ידלק", "שתדליק", "שתפעיל", "תתחיל", "תתחילי"].map(speak));

const ONES: Record<string, number> = foldKeys({
  אחת: 1,
  אחד: 1,
  שתיים: 2,
  שניים: 2,
  שתים: 2,
  שלוש: 3,
  ארבע: 4,
  חמש: 5,
  שש: 6,
  שבע: 7,
  שמונה: 8,
  תשע: 9,
});

const TEENS: Record<string, number> = foldKeys({
  עשרה: 10,
  עשר: 10,
  "אחת עשרה": 11,
  "אחד עשר": 11,
  "שתים עשרה": 12,
  "שתיים עשרה": 12,
  "שנים עשרה": 12,
  "שנים עשר": 12,
  "שלוש עשרה": 13,
  "ארבע עשרה": 14,
  "חמש עשרה": 15,
  "שש עשרה": 16,
  "שבע עשרה": 17,
  "שמונה עשרה": 18,
  "תשע עשרה": 19,
});

const TENS: Record<string, number> = foldKeys({ עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50 });

const WEEKDAY_NUMBER: Record<string, number> = foldKeys({
  ראשון: 0,
  שני: 1,
  שלישי: 2,
  רביעי: 3,
  חמישי: 4,
  שישי: 5,
  שבת: 6,
});

const WEEKDAY_WORD = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];

const PHRASES: Array<[string, number]> = ([
  ["שעתיים ושלושת רבעי שעה", 165],
  ["שעתיים ושלושה רבעי שעה", 165],
  ["שעתיים וחצי שעה", 150],
  ["שעתיים וחצי", 150],
  ["שעתיים ורבע שעה", 135],
  ["שעתיים ורבע", 135],
  ["שתי שעות וחצי", 150],
  ["שתי שעות", 120],
  ["שעתיים", 120],
  ["שעה ושלושת רבעי שעה", 105],
  ["שעה ושלושת רבעי", 105],
  ["שעה וחצי", 90],
  ["שעה ורבע", 75],
  ["שלושת רבעי שעה", 45],
  ["שלושה רבעי שעה", 45],
  ["חצי שעה", 30],
  ["רבע שעה", 15],
  ["לשעה וחצי", 90],
  ["לשעה ורבע", 75],
  ["לשעה ושלושת רבעי", 105],
  ["לשעה", 60],
] as Array<[string, number]>).map(([phrase, minutes]) => [speak(phrase), minutes] as [string, number]);

const HOUR_WORD = ["אחת עשרה", "אחד עשר", "שתים עשרה", "שתיים עשרה", "שנים עשרה", "שנים עשר", "עשרה", "אחת", "אחד", "שתיים", "שניים", "שתים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר"]
  .map(speak)
  .sort((left, right) => right.length - left.length)
  .join("|");

const PARTS: Array<[string, Part]> = (
  [
    ["אחר הצהריים", "afternoon"],
    ["בצהריים", "noon"],
    ["צהריים", "noon"],
    ["בבוקר", "morning"],
    ["בוקר", "morning"],
    ["בערב", "evening"],
    ["ערב", "evening"],
    ["בלילה", "night"],
    ["לילה", "night"],
  ] as Array<[string, Part]>
)
  .map(([phrase, part]) => [speak(phrase), part] as [string, Part])
  .sort((left, right) => right[0].length - left[0].length);

type Part = "morning" | "noon" | "afternoon" | "evening" | "night";

type ClockHit = {
  end: number;
  hour: number;
  minute: number;
  absolute: boolean;
  part: Part | null;
};

type When =
  | { kind: "relative"; days: 0 | 1 | 2; word: string }
  | { kind: "weekday"; weekday: number; word: string };

function letterAt(text: string, index: number) {
  const char = text[index] ?? "";
  return /[\u0590-\u05FF]/.test(char);
}

function boundary(text: string, index: number) {
  if (index === 0) return true;
  const prev = text[index - 1] ?? "";
  if (/\s/.test(prev)) return true;
  return /[לבמהו]/.test(prev) && (index === 1 || /\s/.test(text[index - 2] ?? ""));
}

function wordEnd(text: string, index: number) {
  return !letterAt(text, index);
}

function matchNumber(text: string, index: number): { value: number; length: number } | null {
  const rest = text.slice(index);
  const digit = /^(?:0|[1-9]\d{0,2})(?!\d)/.exec(rest);
  if (digit) return { value: Number(digit[0]), length: digit[0].length };
  const teens = Object.keys(TEENS).sort((left, right) => right.length - left.length);
  for (const key of teens) {
    if (rest.startsWith(key) && wordEnd(rest, key.length)) return { value: TEENS[key] ?? 0, length: key.length };
  }
  const tens = Object.keys(TENS).sort((left, right) => right.length - left.length);
  for (const key of tens) {
    if (!rest.startsWith(key)) continue;
    const and = /^\s+ו/.exec(rest.slice(key.length));
    if (and) {
      const unit = matchMapped(rest.slice(key.length + and[0].length), ONES);
      if (unit) return { value: (TENS[key] ?? 0) + unit.value, length: key.length + and[0].length + unit.length };
    }
    if (wordEnd(rest, key.length)) return { value: TENS[key] ?? 0, length: key.length };
  }
  return matchMapped(rest, ONES);
}

function matchMapped(rest: string, table: Record<string, number>): { value: number; length: number } | null {
  const keys = Object.keys(table).sort((left, right) => right.length - left.length);
  for (const key of keys) {
    if (rest.startsWith(key) && wordEnd(rest, key.length)) return { value: table[key] ?? 0, length: key.length };
  }
  return null;
}

function matchSpoken(rest: string, phrases: Array<[string, number]>): { minutes: number; length: number } | null {
  for (const [phrase, minutes] of phrases) {
    const folded = speak(phrase);
    const match = new RegExp(`^\\s+${folded}(?![\\u0590-\\u05FF])`).exec(rest);
    if (match) return { minutes, length: match[0].length };
  }
  return null;
}

function matchExtra(rest: string): { minutes: number; length: number } | null {
  const spoken = matchSpoken(rest, [
    ["ושלושת רבעי שעה", 45],
    ["ושלושה רבעי שעה", 45],
    ["ושלושת רבעי", 45],
    ["ושלושה רבעי", 45],
    ["וארבעים וחמש", 45],
    ["וחצי", 30],
    ["ורבע", 15],
    ["ועשרים", 20],
    ["ושלושים", 30],
    ["וארבעים", 40],
    ["וחמישים", 50],
  ]);
  if (spoken) return spoken;
  const digits = /^\s+ו(\d{1,2})\s+דקות?(?![\u0590-\u05FF])/.exec(rest);
  if (digits) {
    const minutes = Number(digits[1]);
    if (minutes > 0 && minutes < 60) return { minutes, length: digits[0].length };
  }
  return null;
}

function matchDuration(text: string, index: number): { minutes: number; length: number } | null {
  const rest = text.slice(index);
  for (const [phrase, minutes] of PHRASES) {
    if (rest.startsWith(phrase) && wordEnd(rest, phrase.length)) return { minutes, length: phrase.length };
  }
  if (rest.startsWith("שעה") && wordEnd(rest, 3)) {
    const prev = text[index - 1] ?? "";
    const before = text.slice(Math.max(0, index - 6), index);
    if (prev === "ל" || before.includes(speak("משך"))) return { minutes: 60, length: 3 };
  }
  const amount = matchNumber(text, index);
  if (!amount || amount.value < 1 || amount.value > 24 * 60) return null;
  const after = text.slice(index + amount.length);
  const halfHour = /^\s+וחצי\s+שעה(?![\u0590-\u05FF])/.exec(after);
  if (halfHour && amount.value < 24) return { minutes: amount.value * 60 + 30, length: amount.length + halfHour[0].length };
  const quarterHour = /^\s+ורבע\s+שעה(?![\u0590-\u05FF])/.exec(after);
  if (quarterHour && amount.value < 24) return { minutes: amount.value * 60 + 15, length: amount.length + quarterHour[0].length };
  const hours = /^\s+שעות(?![\u0590-\u05FF])/.exec(after);
  if (hours && amount.value <= 24) {
    let length = amount.length + hours[0].length;
    const extra = matchExtra(text.slice(index + length));
    const minutes = amount.value * 60 + (extra?.minutes ?? 0);
    if (extra) length += extra.length;
    if (minutes >= 1 && minutes <= 24 * 60) return { minutes, length };
  }
  const mins = /^\s+דקות?(?![\u0590-\u05FF])/.exec(after);
  if (mins && amount.value <= 24 * 60) return { minutes: amount.value, length: amount.length + mins[0].length };
  return null;
}

function blankDurations(text: string) {
  let minutes: number | null = null;
  let count = 0;
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (!boundary(text, index)) {
      out += text[index];
      index += 1;
      continue;
    }
    const match = matchDuration(text, index);
    if (!match) {
      out += text[index];
      index += 1;
      continue;
    }
    count += 1;
    minutes = match.minutes;
    out += " ".repeat(match.length);
    index += match.length;
  }
  return { text: out, minutes, count };
}

function hourNumber(word: string): number | null {
  if (/^\d{1,2}$/.test(word)) {
    const value = Number(word);
    return value >= 0 && value <= 23 ? value : null;
  }
  return TEENS[word] ?? ONES[word] ?? null;
}

function takePart(rest: string): { part: Part | null; length: number } {
  for (const [phrase, part] of PARTS) {
    const match = new RegExp(`^\\s+${phrase}(?![\\u0590-\\u05FF])`).exec(rest);
    if (match) return { part, length: match[0].length };
  }
  return { part: null, length: 0 };
}

function matchClock(text: string, index: number): ClockHit | null {
  const rest = text.slice(index);
  const quarter = new RegExp(`^רבע\\s+לה?(${HOUR_WORD}|\\d{1,2})(?![\\u0590-\\u05FF\\d])`).exec(rest);
  if (quarter) {
    const raw = hourNumber(quarter[1] ?? "");
    if (raw == null || raw < 1 || raw > 12) return null;
    const hour = raw === 1 ? 12 : raw - 1;
    const part = takePart(rest.slice(quarter[0].length));
    return { end: index + quarter[0].length + part.length, hour, minute: 45, absolute: false, part: part.part };
  }
  const clock = new RegExp(`^(?:[במלה])?(?:(\\d{1,2})(?::(\\d{2}))?|(${HOUR_WORD}))(?![\\u0590-\\u05FF\\d])`).exec(rest);
  if (!clock) return null;
  const word = clock[1] ?? clock[3] ?? "";
  const hour = hourNumber(word);
  if (hour == null) return null;
  let minute = clock[2] ? Number(clock[2]) : 0;
  if (minute > 59) return null;
  let consumed = clock[0].length;
  const tail = matchMinuteTail(rest.slice(consumed));
  if (tail) {
    if (clock[2]) return null;
    minute = tail.minute;
    consumed += tail.length;
  }
  const after = rest.slice(consumed);
  if (/^\s+(?:שעות|שעה|דקות|דקה)(?![\u0590-\u05FF])/.test(after)) return null;
  const part = takePart(after);
  const absolute = Boolean(clock[1]) && (hour >= 13 || hour === 0);
  if (!absolute && (hour < 1 || hour > 12)) return null;
  return { end: index + consumed + part.length, hour, minute, absolute, part: part.part };
}

function matchMinuteTail(rest: string): { minute: number; length: number } | null {
  const spoken = matchSpoken(rest, [
    ["וארבעים וחמש", 45],
    ["וחצי", 30],
    ["ורבע", 15],
    ["ועשרים", 20],
    ["ושלושים", 30],
    ["וארבעים", 40],
    ["וחמישים", 50],
  ]);
  if (spoken) return { minute: spoken.minutes, length: spoken.length };
  const digits = /^\s+ו(\d{1,2})(?!\d)/.exec(rest);
  if (digits) {
    const minute = Number(digits[1]);
    if (minute < 60) return { minute, length: digits[0].length };
  }
  return null;
}

function findClocks(text: string): ClockHit[] {
  const hits: ClockHit[] = [];
  let index = 0;
  while (index < text.length) {
    if (!boundary(text, index)) {
      index += 1;
      continue;
    }
    const hit = matchClock(text, index);
    if (!hit) {
      index += 1;
      continue;
    }
    hits.push(hit);
    index = Math.max(hit.end, index + 1);
  }
  return hits;
}

function partMinutes(hour: number, minute: number, part: Part): number | null {
  if (minute < 0 || minute > 59 || hour < 1 || hour > 12) return null;
  if (part === "morning") return (hour === 12 ? 0 : hour) * 60 + minute;
  if (part === "noon" || part === "afternoon") return (hour === 12 ? 12 : hour + 12) * 60 + minute;
  if (part === "evening") return (hour === 12 ? 0 : hour + 12) * 60 + minute;
  if (hour === 12) return minute;
  if (hour <= 4) return hour * 60 + minute;
  return (hour + 12) * 60 + minute;
}

function absoluteMinutes(hit: ClockHit): number | null {
  if (!hit.absolute) return null;
  const minutes = hit.hour * 60 + hit.minute;
  if (!hit.part) return minutes;
  const hour12 = hit.hour === 0 ? 12 : hit.hour > 12 ? hit.hour - 12 : hit.hour;
  return partMinutes(hour12, hit.minute, hit.part) === minutes ? minutes : null;
}

function looseOptions(hit: ClockHit): number[] {
  if (hit.absolute) {
    const minutes = absoluteMinutes(hit);
    return minutes == null ? [] : [minutes];
  }
  const base = hit.hour === 12 ? 12 * 60 + hit.minute : hit.hour * 60 + hit.minute;
  const options = [base];
  if (hit.hour < 12) options.push((hit.hour + 12) * 60 + hit.minute);
  if (hit.hour === 12) options.push(hit.minute);
  return options;
}

function knownMinutes(hit: ClockHit): number | "ambiguous" | "bad" {
  if (hit.absolute) return absoluteMinutes(hit) ?? "bad";
  if (!hit.part) return "ambiguous";
  return partMinutes(hit.hour, hit.minute, hit.part) ?? "bad";
}

function inferEnd(hit: ClockHit, start: number): number | "ambiguous" | "bad" {
  const known = knownMinutes(hit);
  if (known === "bad") return "bad";
  if (typeof known === "number") {
    const end = known <= start ? known + 1440 : known;
    return end - start <= 1440 ? end : "bad";
  }
  const after = [...new Set(looseOptions(hit).map((value) => (value <= start ? value + 1440 : value)))].filter(
    (value) => value > start && value - start <= 12 * 60,
  );
  return after.length === 1 ? after[0] : "ambiguous";
}

function inferStart(hit: ClockHit, end: number): number | "ambiguous" | "bad" {
  const known = knownMinutes(hit);
  if (known === "bad") return "bad";
  if (typeof known === "number") return known < end ? known : "bad";
  const before = [...new Set(looseOptions(hit).flatMap((value) => [value, value - 1440]))].filter(
    (value) => value >= 0 && value < end && end - value <= 18 * 60,
  );
  return before.length === 1 ? before[0] : "ambiguous";
}

function findWhen(text: string): When | "none" | "many" {
  const hits: Array<{ index: number; length: number; when: When }> = [];
  const take = (pattern: RegExp, build: (match: RegExpExecArray) => When | null) => {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const when = build(match);
      if (when) hits.push({ index: match.index, length: match[0].length, when });
      match = pattern.exec(text);
    }
  };
  const dayNames = Object.keys(WEEKDAY_NUMBER).join("|");
  take(new RegExp(speak("מחרתיים"), "g"), () => ({ kind: "relative", days: 2, word: "מחרתיים" }));
  take(new RegExp(speak("מחר"), "g"), () => ({ kind: "relative", days: 1, word: "מחר" }));
  take(new RegExp(speak("היום"), "g"), () => ({ kind: "relative", days: 0, word: "היום" }));
  take(
    new RegExp(`(?:^|\\s)ב?${speak("יום")}\\s+(${dayNames})(?=\\s|$)`, "g"),
    (match) => {
      const weekday = WEEKDAY_NUMBER[match[1] ?? ""];
      if (weekday == null) return null;
      return { kind: "weekday", weekday, word: WEEKDAY_WORD[weekday] ?? "" };
    },
  );
  take(
    new RegExp(`(?:^|\\s)ב(${dayNames})(?=\\s|$)`, "g"),
    (match) => {
      const weekday = WEEKDAY_NUMBER[match[1] ?? ""];
      if (weekday == null) return null;
      return { kind: "weekday", weekday, word: WEEKDAY_WORD[weekday] ?? "" };
    },
  );
  hits.sort((left, right) => right.length - left.length || left.index - right.index);
  const kept: typeof hits = [];
  for (const hit of hits) {
    const overlaps = kept.some((item) => hit.index < item.index + item.length && item.index < hit.index + hit.length);
    if (!overlaps) kept.push(hit);
  }
  if (!kept.length) return "none";
  if (kept.length > 1) return "many";
  return kept[0].when;
}

function wantsOn(text: string) {
  return text.split(" ").some((word) => SCHEDULE_ON.has(word));
}

function hhmm(minutes: number) {
  const mod = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(mod / 60)).padStart(2, "0")}:${String(mod % 60).padStart(2, "0")}`;
}

function resolveDay(when: When, onTime: string, now: Date): { day: string; word: string } | "past" {
  const today = israelDate(now);
  if (when.kind === "relative") {
    const day = shiftDate(today, when.days);
    const at = jerusalemInstant(day, onTime);
    if (!at || at.getTime() <= now.getTime()) return "past";
    return { day, word: when.word };
  }
  let day = today;
  for (let step = 0; step < 8; step += 1) {
    if (weekdayOf(day) === when.weekday) {
      const at = jerusalemInstant(day, onTime);
      if (at && at.getTime() > now.getTime()) return { day, word: when.word };
    }
    day = shiftDate(day, 1);
  }
  return "past";
}

function fail(speech: string): VoiceClock {
  return { ok: false, speech };
}

/**
 * A one-time clock, or null when the sentence is an immediate on, off, or timer.
 * Missing date, hour, or end time is a clarification, not a guess.
 */
export function parseVoiceClock(transcript: string, now = new Date()): VoiceClock | null {
  const text = foldVoice(transcript);
  if (!text) return null;
  const when = findWhen(text);
  const durations = blankDurations(text);
  const clocks = findClocks(durations.text);
  if (when === "none" && clocks.length === 0) return null;
  if (voiceAction(text) === "STATUS") return null;

  const action = voiceAction(text);
  const scheduleOn = wantsOn(text);
  if (action === "BOTH" || (action === "OFF" && scheduleOn)) return fail("לא הבנתי אם להדליק או לכבות. אמור שוב");
  if (action === "OFF") return fail("אפשר לתזמן הדלקה וכיבוי, לא כיבוי בלבד");
  if (action !== "ON" && !scheduleOn) return fail("לא הבנתי אם להדליק. אמור תדליק או תפעיל");
  if (when === "many") return fail("לא הבנתי את התאריך. אמור היום, מחר, או יום בשבוע");
  if (when === "none") return fail("לא הבנתי את התאריך. אמור היום, מחר, או יום בשבוע");
  if (clocks.length > 2) return fail("לא הבנתי את השעות. אמור שעת הדלקה ושעת כיבוי");
  if (clocks.length === 0) return fail("לא הבנתי מתי להדליק");
  if (clocks.length === 1 && durations.count === 0) return fail("לא הבנתי מתי לכבות");
  if (clocks.length === 2 && durations.count > 0) return fail("לא הבנתי אם זה משך זמן או שעת כיבוי");
  if (durations.count > 1) return fail("לא הבנתי את משך ההפעלה");

  const startHit = clocks[0];
  const endHit = clocks[1];
  let start: number | "ambiguous" | "bad";
  let end: number | "ambiguous" | "bad";
  if (endHit) {
    const endKnown = knownMinutes(endHit);
    const startKnown = knownMinutes(startHit);
    if (startKnown === "ambiguous" && typeof endKnown === "number") start = inferStart(startHit, endKnown);
    else start = startKnown;
    if (typeof start !== "number") end = start;
    else end = inferEnd(endHit, start);
  } else {
    start = knownMinutes(startHit);
    end = typeof start === "number" ? start + (durations.minutes ?? 0) : start;
  }
  if (start === "bad" || end === "bad") return fail("השעה לא מתאימה לחלק היום. אמור שוב");
  if (start === "ambiguous" || end === "ambiguous") return fail("לא הבנתי אם השעה בבוקר או בערב");
  if (end <= start || end - start > 1440) return fail("אפשר לתזמן עד עשרים וארבע שעות");

  const onTime = hhmm(start);
  const offTime = hhmm(end);
  const day = resolveDay(when, onTime, now);
  if (day === "past") return fail("השעה הזו כבר עברה. אמור שעה עתידית");
  return { ok: true, day: day.day, onTime, offTime, dayWord: day.word };
}

export function clockConfirmSpeech(name: string, dayWord: string, onTime: string, offTime: string) {
  const who = name.startsWith("ה") ? name : `ה${name}`;
  const when = dayWord === "היום" ? "להיום" : `ל${dayWord}`;
  const overnight = offTime <= onTime ? " למחרת" : "";
  return `לתזמון ${who} ${when} מ${spokenClockTime(onTime)} עד ${spokenClockTime(offTime)}${overnight}, הקישו 1 לאישור או 2 לביטול`;
}
