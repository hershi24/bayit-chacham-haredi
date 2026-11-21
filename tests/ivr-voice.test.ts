import assert from "node:assert/strict";
import test from "node:test";
import { decideMenu, type MenuDevice } from "../lib/ivr/flow";
import { handleMenu } from "../lib/ivr/menu";
import { parseVoiceCommand, voiceCheckSpeech } from "../lib/ivr/voice-command";
import { googleTranscript, pcmToFlac, readWavPcm } from "../lib/ivr/voice-audio";
import { answerVoice, recordingTarget, setVoicePorts } from "../lib/ivr/voice-turn";
import { yemotRead, yemotRecord } from "../lib/ivr/yemot";
import { getDevice, updateDeviceState } from "../lib/store";
import { getBridge } from "../lib/wlte/bridge";

const salon: MenuDevice = { deviceId: "light-salon", name: "תאורה בסלון", relayOn: false, connectivity: "ONLINE" };
const bedroom: MenuDevice = { deviceId: "ac-bed", name: "מזגן חדר שינה", relayOn: false, connectivity: "ONLINE" };
const boiler: MenuDevice = { deviceId: "boiler", name: "דוד", relayOn: true, connectivity: "ONLINE" };
const boilerSun: MenuDevice = { deviceId: "boiler-sun", name: "דוד שמש", relayOn: false, connectivity: "ONLINE" };
const kitchen: MenuDevice = { deviceId: "kitchen", name: "תאורה במטבח", relayOn: false, connectivity: "ONLINE" };
const devices = [salon, bedroom, boiler, kitchen];

test("a spoken command names one real device and leaves a tie alone", () => {
  assert.deepEqual(parseVoiceCommand("תדליק את האור בסלון", devices), { kind: "on", device: salon });
  assert.deepEqual(parseVoiceCommand("הפעל מזגן בחדר שינה", devices), { kind: "on", device: bedroom });
  assert.deepEqual(parseVoiceCommand("כבה את הדוד", devices), { kind: "off", device: boiler });
  assert.deepEqual(parseVoiceCommand("מה המצב של התאורה במטבח", devices), { kind: "status", device: kitchen });
  assert.equal(parseVoiceCommand("תדליק את הדוד לחצי שעה", devices).kind, "timer");
  assert.equal(parseVoiceCommand("תכבה לי את כל האורות", devices).kind, "clarify");
  assert.match(voiceCheckSpeech(parseVoiceCommand("תכבה לי את כל האורות", devices)), /התקן אחד/);
  assert.equal(parseVoiceCommand("כבה את הדוד", [boiler, boilerSun]).kind, "clarify");
  assert.match(voiceCheckSpeech(parseVoiceCommand("כבה את הדוד", [boiler, boilerSun])), /השם המדויק/);
  assert.match(voiceCheckSpeech(parseVoiceCommand("תדליק את האור בסלון", devices)), /בשלב הבדיקה ההתקן לא הופעל/);
  assert.match(voiceCheckSpeech(parseVoiceCommand("מה המצב של התאורה במטבח", devices)), /כבוי כעת/);
  assert.match(voiceCheckSpeech(parseVoiceCommand("מה המצב של התאורה במטבח", devices)), /לא בוצע שינוי/);
});

test("the recording request uses Yemot record syntax on the same read", () => {
  const line = yemotRecord({ message: "אנא אמור בקול ברור איזו פעולה ברצונך לבצע.", field: "pikud_v1", fileName: "v1123", maxSeconds: 8 });
  assert.match(line, /^read=t-אנא אמור בקול ברור איזו פעולה ברצונך לבצע,=/);
  assert.match(line, /=pikud_v1,no,record,,v1123,no,,no,1,8\n$/);
  assert.equal(line.includes(",voice"), false);
  const list = decideMenu([salon], {});
  assert.equal(list.type, "read");
  if (list.type !== "read") return;
  const slots = yemotRead(list).trim().split("=").at(-1)?.split(",") ?? [];
  assert.equal(slots[6], "");
  assert.equal(slots[9]?.includes("*"), true);
});

test("a recording path is a Yemot file, not an address the server would fetch", () => {
  assert.equal(recordingTarget("/6/v1123.wav"), "ivr2:/6/v1123.wav");
  assert.equal(recordingTarget("ivr2:/6/v1123.wav"), "ivr2:/6/v1123.wav");
  assert.equal(recordingTarget("https://evil.example/6/v1123.wav"), null);
  assert.equal(recordingTarget("/6/../../etc/passwd"), null);
  assert.equal(recordingTarget("None"), null);
});

function wav(samples: number[]) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Uint8Array.from(Buffer.concat([header, data]));
}

test("a phone wav becomes a flac stream and a Google body becomes Hebrew", () => {
  const pcm = readWavPcm(wav([0, 1000, -1000, 0]));
  assert.ok(pcm);
  assert.equal(pcm?.rate, 8000);
  const flac = pcmToFlac(pcm?.samples ?? new Int16Array(), pcm?.rate ?? 8000);
  assert.equal(String.fromCharCode(...flac.subarray(0, 4)), "fLaC");
  assert.equal(googleTranscript('{"result":[]}\n{"result":[{"alternative":[{"transcript":"תדליק את הדוד"}],"final":true}]}'), "תדליק את הדוד");
  assert.equal(googleTranscript('{"result":[]}'), null);
});

test("a recording without the Yemot file token returns to the keypad menu", async () => {
  const previous = process.env.YEMOT_TOKEN;
  delete process.env.YEMOT_TOKEN;
  setVoicePorts(null);
  try {
    const body = await answerVoice({
      values: { pikud_device: "*", pikud_v1: "/6/v1.wav" },
      devices: [salon],
      callId: "missing-token",
      phone: "035551001",
    });
    assert.match(body ?? "", /אין עדיין חיבור להורדת הקבצים/);
    assert.match(body ?? "", /חוזרים לתפריט המקשים/);
    assert.match(body ?? "", /read=t-/);
  } finally {
    if (previous === undefined) delete process.env.YEMOT_TOKEN;
    else process.env.YEMOT_TOKEN = previous;
    setVoicePorts(null);
  }
});

test("star records on the current menu and the transcript does not switch the socket", async () => {
  await updateDeviceState("rct063285302", {
    connectivity: "ONLINE",
    relayOn: false,
    stateUpdatedAt: new Date().toISOString(),
    lastError: null,
  });
  await getBridge().simulate("rct063285302", { online: true, relayOn: false });
  let transcripts = 0;
  const removed: string[] = [];
  let loads = 0;
  setVoicePorts({
    load: async (path) => {
      loads += 1;
      assert.equal(path, "ivr2:/6/v1123.wav");
      return wav([0, 1, -1, 0]);
    },
    transcribe: async () => {
      transcripts += 1;
      return "תדליק את האולם";
    },
    remove: async (path) => {
      removed.push(path);
    },
  });
  try {
    const star = await handleMenu(
      new Request("http://127.0.0.1/api/ivr/menu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
        body: new URLSearchParams({ ApiPhone: "035551001", pikud_device: "*", ApiCallId: "555" }),
      }),
    );
    const starText = await star.text();
    assert.match(starText, /אנא אמור בקול ברור איזו פעולה ברצונך לבצע/);
    assert.match(starText, /pikud_v1,no,record,/);
    assert.equal(starText.includes("go_to_folder"), false);
    assert.equal(loads, 0);

    const heard = await handleMenu(
      new Request("http://127.0.0.1/api/ivr/menu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
        body: new URLSearchParams({
          ApiPhone: "035551001",
          pikud_device: "*",
          ApiCallId: "555",
          pikud_v1: "/6/v1123.wav",
        }),
      }),
    );
    const heardText = await heard.text();
    assert.match(heardText, /זיהיתי להדליק את שקע אולם/);
    assert.match(heardText, /בשלב הבדיקה ההתקן לא הופעל/);
    assert.match(heardText, /חוזרים לתפריט המקשים/);
    assert.match(heardText, /read=t-/);
    assert.equal(heardText.includes("go_to_folder=hangup"), false);
    assert.equal(transcripts, 1);
    assert.deepEqual(removed, ["ivr2:/6/v1123.wav"]);

    const again = await handleMenu(
      new Request("http://127.0.0.1/api/ivr/menu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
        body: new URLSearchParams({
          ApiPhone: "035551001",
          pikud_device: "*",
          ApiCallId: "555",
          pikud_v1: "/6/v1123.wav",
        }),
      }),
    );
    assert.equal(await again.text(), heardText);
    assert.equal(transcripts, 1);

    const refused = await handleMenu(
      new Request("http://127.0.0.1/api/ivr/menu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
        body: new URLSearchParams({
          ApiPhone: "035551001",
          pikud_device: "1",
          pikud_v1: "https://evil.example/a.wav",
        }),
      }),
    );
    assert.equal((await refused.text()).includes("evil.example"), false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal((await getDevice("rct063285302"))?.relayOn, false);
  } finally {
    setVoicePorts(null);
  }
});
