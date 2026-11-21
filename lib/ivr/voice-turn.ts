import { decideMenu, type MenuDevice } from "@/lib/ivr/flow";
import { parseVoiceCommand, voiceCheckSpeech } from "@/lib/ivr/voice-command";
import { transcribeHebrew } from "@/lib/ivr/voice-audio";
import { yemotContinue, yemotRead, yemotRecord } from "@/lib/ivr/yemot";

const YEMOT_API = "https://www.call2all.co.il/ym/api";
const RECORD_SECONDS = 8;
const STEP_TIMEOUT_MS = 8_000;
const REPLAY_MS = 25_000;
const MEMORY_MS = 10 * 60_000;

const PROMPT = "אנא אמור בקול ברור איזו פעולה ברצונך לבצע.";
const BACK = "חוזרים לתפריט המקשים";

type VoicePorts = {
  load: (path: string) => Promise<Uint8Array | "missing-token" | null>;
  transcribe: (wav: Uint8Array) => Promise<string | null>;
  remove: (path: string) => Promise<void>;
};

let ports: VoicePorts | null = null;
const done = new Map<string, number>();
const replay = new Map<string, { at: number; body: string }>();

export function setVoicePorts(next: VoicePorts | null) {
  ports = next;
  done.clear();
  replay.clear();
}

function remember(key: string, body: string) {
  const now = Date.now();
  for (const [name, at] of done) if (now - at > MEMORY_MS) done.delete(name);
  for (const [name, item] of replay) if (now - item.at > REPLAY_MS) replay.delete(name);
  done.set(key, now);
  replay.set(key, { at: now, body });
}

function isStar(value: string | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === "*" || trimmed === "star";
}

function filled(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase() === "none" || trimmed === "null") return "";
  return trimmed;
}

/** A recording path Yemot posts back. Full URLs are refused so the server never fetches them. */
export function recordingTarget(raw: string): string | null {
  let path = raw.trim();
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path.startsWith("ivr2:")) path = path.slice(5);
  if (!path.startsWith("/") || path.includes("..") || path.includes("//")) return null;
  if (!/^\/(?:\d+\/)+[A-Za-z0-9._-]+\.wav$/i.test(path)) return null;
  return `ivr2:${path}`;
}

function yemotToken() {
  const token = process.env.YEMOT_TOKEN?.trim() ?? "";
  return token.includes(":") ? token : "";
}

async function yemotCall(command: string, params: Record<string, string>): Promise<Response | null> {
  const token = yemotToken();
  if (!token) return null;
  const url = new URL(`${YEMOT_API}/${command}`);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    return await fetch(url, { signal: AbortSignal.timeout(STEP_TIMEOUT_MS), redirect: "manual" });
  } catch (error) {
    console.error("[pikud] voice file", command, error instanceof Error ? error.message : "failed");
    return null;
  }
}

async function loadRecording(target: string): Promise<Uint8Array | "missing-token" | null> {
  if (!yemotToken()) return "missing-token";
  const response = await yemotCall("DownloadFile", { path: target });
  if (!response || response.status !== 200) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 44 || bytes[0] === 0x7b) return null;
  return bytes;
}

async function removeRecording(target: string) {
  await yemotCall("FileAction", { action: "delete", what: target });
}

function activePorts(): VoicePorts {
  return (
    ports ?? {
      load: loadRecording,
      transcribe: (wav) => transcribeHebrew(wav, STEP_TIMEOUT_MS),
      remove: removeRecording,
    }
  );
}

function slots(values: Record<string, string>) {
  const found: Array<{ n: number; value: string }> = [];
  for (const [key, value] of Object.entries(values)) {
    const match = /^pikud_v(\d+)$/.exec(key);
    if (!match) continue;
    found.push({ n: Number(match[1]), value: filled(value) });
  }
  found.sort((left, right) => left.n - right.n);
  return found;
}

function fileName(callId: string, phone: string, n: number) {
  const digits = `${callId}${phone}`.replace(/\D/g, "").slice(-10);
  return `v${n}${digits || "0"}`;
}

function menuRead(devices: MenuDevice[]) {
  const decision = decideMenu(devices, {});
  return decision.type === "read"
    ? yemotRead(decision)
    : yemotRead({
        message: "לפקודה קולית הקש כוכבית",
        field: "pikud_device",
        min: 1,
        max: 1,
        allowed: "*",
        allowStar: true,
      });
}

function back(speech: string, devices: MenuDevice[]) {
  return yemotContinue(`${speech}. ${BACK}`, menuRead(devices));
}

/**
 * Star on the socket list starts a recording on this same API extension.
 * A later post of the file path is transcribed and spoken back.
 * Nothing here switches a relay: this pass only checks that the sentence was understood.
 * Returns null when this request is an ordinary keypress.
 */
export async function answerVoice(input: {
  values: Record<string, string>;
  devices: MenuDevice[];
  callId: string;
  phone: string;
}): Promise<string | null> {
  if (!isStar(input.values.pikud_device)) return null;

  const heard = slots(input.values);
  const latest = heard.at(-1);
  const next = (latest?.n ?? 0) + 1;
  const callKey = input.callId || input.phone || "call";

  if (!latest || !latest.value) {
    return yemotRecord({
      message: PROMPT,
      field: `pikud_v${next}`,
      fileName: fileName(input.callId, input.phone, next),
      maxSeconds: RECORD_SECONDS,
    });
  }

  const target = recordingTarget(latest.value);
  const key = `${callKey}|${target ?? latest.value}`;
  if (done.has(key)) {
    const cached = replay.get(key);
    if (cached && Date.now() - cached.at < REPLAY_MS) return cached.body;
    return yemotRecord({
      message: PROMPT,
      field: `pikud_v${next}`,
      fileName: fileName(input.callId, input.phone, next),
      maxSeconds: RECORD_SECONDS,
    });
  }

  const engine = activePorts();
  let speech: string;
  if (!target) {
    speech = "ההקלטה לא התקבלה בנתיב תקין";
  } else {
    const audio = await engine.load(target);
    if (audio === "missing-token") speech = "ההקלטה התקבלה, ואין עדיין חיבור להורדת הקבצים מימות המשיח";
    else if (!audio) speech = "לא הצלחתי לקרוא את ההקלטה";
    else {
      const transcript = await engine.transcribe(audio);
      speech = transcript
        ? voiceCheckSpeech(parseVoiceCommand(transcript, input.devices))
        : "לא הצלחתי לזהות את הדיבור";
    }
    try {
      await engine.remove(target);
    } catch (error) {
      console.error("[pikud] voice delete", error instanceof Error ? error.message : "failed");
    }
  }

  const body = back(speech, input.devices);
  remember(key, body);
  return body;
}
