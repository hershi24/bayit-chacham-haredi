import type { MenuDevice } from "@/lib/ivr/flow";
import { speechFor } from "@/lib/ivr/speech";
import { clockConfirmSpeech, parseVoiceClock } from "@/lib/ivr/voice-clock";
import { FILLER, OFF, ON, foldVoice, stemVoice, voiceAction, voiceWords } from "@/lib/ivr/voice-text";

export { foldVoice, voiceAction };

export type VoiceCommand =
  | { kind: "on"; device: MenuDevice }
  | { kind: "off"; device: MenuDevice }
  | { kind: "timer"; device: MenuDevice; minutes: number }
  | { kind: "status"; device: MenuDevice }
  | { kind: "clock"; device: MenuDevice; day: string; onTime: string; offTime: string; speech: string }
  | { kind: "clarify"; speech: string };

const GENERIC = new Set(["שקע", "ערוץ", "התקן", "מכשיר"]);

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

function words(text: string): string[] {
  return voiceWords(text).map((word) => stemVoice(word)).filter((word) => word.length > 1);
}

function isGroup(text: string): boolean {
  const folded = foldVoice(text);
  return /(?:^|\s)הכל(?:\s|$)/.test(folded) || folded.includes("כולם") || folded.includes("כולן") || folded.includes("כל ה");
}

function minutesOf(text: string): number | null {
  const folded = foldVoice(text);
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

const CLOCK_STOP = new Set([
  "יום",
  "מחר",
  "מחרתיים",
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
  "בוקר",
  "צהריים",
  "ערב",
  "לילה",
  "אחר",
  "שעה",
  "שעות",
  "דקה",
  "דקות",
  "רבע",
  "חצי",
  "עד",
  "משך",
  "שעתיים",
  "שלושת",
  "שלושה",
  "רבעי",
  "הקרוב",
  "הבא",
  "אחת",
  "אחד",
  "שתיים",
  "שניים",
  "שתים",
  "שלוש",
  "ארבע",
  "חמש",
  "שש",
  "שבע",
  "שמונה",
  "תשע",
  "עשר",
  "עשרה",
  "עשרים",
  "שלושים",
  "ארבעים",
  "חמישים",
  "שידלק",
  "ידלק",
  "שתדליק",
  "שתפעיל",
  "תתחיל",
  "תתחילי",
].map((word) => foldVoice(word)));

function pickDevice(text: string, devices: MenuDevice[], stop: Set<string>) {
  const spoken = new Set<string>();
  for (const word of voiceWords(text)) {
    const token = stemVoice(word);
    if (FILLER.has(word) || FILLER.has(token) || ON.has(word) || ON.has(token) || OFF.has(word) || OFF.has(token)) continue;
    if (stop.has(word) || stop.has(token)) continue;
    if (token === "טיימר" || token === "מצב" || token === "מה") continue;
    if (/^\d+$/.test(token)) continue;
    if (token.length > 1) spoken.add(token);
  }
  const ranked = devices
    .map((device) => ({ device, score: scoreDevice(device, spoken) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.device.name.localeCompare(right.device.name, "he"));
  const best = ranked[0];
  if (!best) return { kind: "none" as const };
  if (ranked[1] && ranked[1].score === best.score) {
    const names = ranked
      .filter((item) => item.score === best.score)
      .slice(0, 3)
      .map((item) => item.device.name)
      .join(", ");
    return { kind: "tie" as const, names };
  }
  return { kind: "one" as const, device: best.device };
}

/**
 * Map a Hebrew sentence onto one of this caller's devices.
 * A future clock is returned only when the sentence actually names a time.
 * A tie, a missing name, or a group phrase stays unresolved.
 */
export function parseVoiceCommand(transcript: string, devices: MenuDevice[], now = new Date()): VoiceCommand {
  const text = transcript.trim();
  if (!text) return { kind: "clarify", speech: "לא שמעתי פקודה. אמור את שם ההתקן ואת הפעולה" };
  if (isGroup(text)) {
    return { kind: "clarify", speech: "פקודה לכל ההתקנים בדיבור לא מופעלת. אמור התקן אחד" };
  }

  const clock = parseVoiceClock(text, now);
  if (clock) {
    if (!clock.ok) return { kind: "clarify", speech: clock.speech };
    const picked = pickDevice(text, devices, CLOCK_STOP);
    if (picked.kind === "none") return { kind: "clarify", speech: "לא הבנתי איזה התקן. אמור את השם שמופיע בתפריט" };
    if (picked.kind === "tie") return { kind: "clarify", speech: `יש כמה התקנים מתאימים: ${picked.names}. אמור את השם המדויק` };
    return {
      kind: "clock",
      device: picked.device,
      day: clock.day,
      onTime: clock.onTime,
      offTime: clock.offTime,
      speech: clockConfirmSpeech(picked.device.name, clock.dayWord, clock.onTime, clock.offTime),
    };
  }

  const action = voiceAction(text);
  if (action === "BOTH") return { kind: "clarify", speech: "לא הבנתי אם להדליק או לכבות. אמור שוב" };

  const picked = pickDevice(text, devices, new Set());
  if (picked.kind === "none") {
    return action
      ? { kind: "clarify", speech: "לא הבנתי איזה התקן. אמור את השם שמופיע בתפריט" }
      : { kind: "clarify", speech: "לא הבנתי את הפקודה. אמור הדלקה או כיבוי ואת שם ההתקן" };
  }
  if (picked.kind === "tie") return { kind: "clarify", speech: `יש כמה התקנים מתאימים: ${picked.names}. אמור את השם המדויק` };
  const best = picked;
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

/** Words for a command that does not switch a relay: a question, a state check, or a clock waiting for a key. */
export function voiceCheckSpeech(command: VoiceCommand): string {
  if (command.kind === "clarify") return command.speech;
  if (command.kind === "clock") return command.speech;
  if (command.kind === "status") {
    return speechFor({ kind: "status", relayOn: command.device.relayOn, name: command.device.name });
  }
  return speechFor({ kind: "failed" });
}
