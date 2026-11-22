import { decideMenu, type MenuDevice } from "@/lib/ivr/flow";
import { parseVoiceCommand, voiceCheckSpeech, type VoiceCommand } from "@/lib/ivr/voice-command";
import { transcribeHebrew } from "@/lib/ivr/voice-audio";
import { yemotContinue, yemotRead, yemotRecord } from "@/lib/ivr/yemot";

const YEMOT_API = "https://www.call2all.co.il/ym/api";
const RECORD_SECONDS = 8;
const STEP_TIMEOUT_MS = 8_000;
const MEMORY_MS = 10 * 60_000;

const PROMPT = "דבר אליי:";
const BACK = "חוזרים לתפריט המקשים";

type VoicePorts = {
  load: (path: string) => Promise<Uint8Array | "missing-token" | null>;
  transcribe: (wav: Uint8Array) => Promise<string | null>;
  remove: (path: string) => Promise<void>;
};

let ports: VoicePorts | null = null;
const done = new Map<string, number>();
const CONFIRM_MS = 3 * 60_000;

type PendingClock = {
  deviceId: string;
  day: string;
  onTime: string;
  offTime: string;
  speech: string;
  at: number;
};

const pending = new Map<string, PendingClock>();

export function setVoicePorts(next: VoicePorts | null) {
  ports = next;
  done.clear();
  pending.clear();
}

function rememberPending(callKey: string, value: Omit<PendingClock, "at">) {
  const now = Date.now();
  for (const [key, item] of pending) if (now - item.at > CONFIRM_MS) pending.delete(key);
  pending.set(callKey, { ...value, at: now });
}

function takePending(callKey: string): PendingClock | "expired" | null {
  const held = pending.get(callKey);
  pending.delete(callKey);
  if (!held) return null;
  if (Date.now() - held.at > CONFIRM_MS) return "expired";
  return held;
}

function remember(key: string) {
  const now = Date.now();
  for (const [name, at] of done) if (now - at > MEMORY_MS) done.delete(name);
  done.set(key, now);
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

/**
 * A recording path Yemot posts back, such as `/12/34/567.wav` or `8/2/001.wav`.
 * Full URLs are refused so the server never fetches them.
 * DownloadFile wants the same path with an `ivr2:` root.
 */
export function recordingTarget(raw: string): string | null {
  let path = raw.trim().replace(/^\uFEFF/, "").replace(/\\/g, "/");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the original text when it is not percent-encoded.
  }
  path = path.trim().replace(/^['"]|['"]$/g, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !path.toLowerCase().startsWith("ivr2:")) return null;
  if (path.toLowerCase().startsWith("ivr2:")) path = path.slice(5);
  path = path.replace(/^\.?\//, "").replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("//") || /\s/.test(path)) return null;
  if (!/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.wav$/i.test(path)) return null;
  return `ivr2:/${path}`;
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
 * A clear on, off, or timer command is handed to `perform`, which uses the keypad actions.
 * A one-time clock is spoken back and saved only after the caller presses 1.
 * An unclear sentence is only spoken back.
 * Returns null when this request is an ordinary keypress.
 */
export async function answerVoice(input: {
  values: Record<string, string>;
  devices: MenuDevice[];
  callId: string;
  phone: string;
  perform?: (command: VoiceCommand) => Promise<string>;
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

  if (latest.value === "1" || latest.value === "2") {
    const confirmKey = `${callKey}|confirm|${latest.n}`;
    if (done.has(confirmKey)) {
      return yemotRecord({
        message: PROMPT,
        field: `pikud_v${next}`,
        fileName: fileName(input.callId, input.phone, next),
        maxSeconds: RECORD_SECONDS,
      });
    }
    remember(confirmKey);
    const held = takePending(callKey);
    if (held === "expired") return back("עבר הזמן לאישור התזמון. אמור את הפקודה שוב", input.devices);
    if (!held) return back("אין תזמון שממתין לאישור", input.devices);
    if (latest.value === "2") return back("התזמון בוטל", input.devices);
    const device = input.devices.find((item) => item.deviceId === held.deviceId);
    if (!device || !input.perform) return back("לא ניתן לשמור את התזמון", input.devices);
    const speech = await input.perform({
      kind: "clock",
      device,
      day: held.day,
      onTime: held.onTime,
      offTime: held.offTime,
      speech: held.speech,
    });
    return back(speech, input.devices);
  }

  const target = recordingTarget(latest.value);
  const key = `${callKey}|${target ?? latest.value}`;
  // Yemot keeps posting the previous path. A finished path must not be spoken or run again.
  if (done.has(key)) {
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
    console.error("[pikud] voice path", latest.value.slice(0, 180));
    speech = "ההקלטה לא התקבלה בנתיב תקין";
  } else {
    const audio = await engine.load(target);
    if (audio === "missing-token") speech = "ההקלטה התקבלה, ואין עדיין חיבור להורדת הקבצים מימות המשיח";
    else if (!audio) speech = "לא הצלחתי לקרוא את ההקלטה";
    else {
      const transcript = await engine.transcribe(audio);
      if (!transcript) speech = "לא הצלחתי לזהות את הדיבור";
      else {
        const command = parseVoiceCommand(transcript, input.devices);
        if (command.kind === "clock") {
          try {
            await engine.remove(target);
          } catch (error) {
            console.error("[pikud] voice delete", error instanceof Error ? error.message : "failed");
          }
          remember(key);
          rememberPending(callKey, {
            deviceId: command.device.deviceId,
            day: command.day,
            onTime: command.onTime,
            offTime: command.offTime,
            speech: command.speech,
          });
          return yemotRead({
            message: command.speech,
            field: `pikud_v${next}`,
            min: 1,
            max: 1,
            allowed: "12",
            seconds: 12,
          });
        }
        speech =
          command.kind !== "clarify" && input.perform ? await input.perform(command) : voiceCheckSpeech(command);
      }
    }
    try {
      await engine.remove(target);
    } catch (error) {
      console.error("[pikud] voice delete", error instanceof Error ? error.message : "failed");
    }
  }

  remember(key);
  return back(speech, input.devices);
}
