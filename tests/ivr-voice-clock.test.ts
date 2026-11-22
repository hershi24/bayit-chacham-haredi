import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { MenuDevice } from "../lib/ivr/flow";
import { handleMenu } from "../lib/ivr/menu";
import { parseVoiceCommand } from "../lib/ivr/voice-command";
import { setVoicePorts } from "../lib/ivr/voice-turn";
import { syncTenantPrograms } from "../lib/programs/sync";
import { createDevice, createTenant, deleteDayClock, deleteDevice, deleteTenant, listDayClocks } from "../lib/store";
import { israelDate, jerusalemInstant, shiftDate } from "../lib/time";

const ac: MenuDevice = { deviceId: "ac", name: "מזגן", relayOn: false, connectivity: "ONLINE" };
const sun: MenuDevice = { deviceId: "sun", name: "דוד שמש", relayOn: false, connectivity: "ONLINE" };
const boiler: MenuDevice = { deviceId: "boiler", name: "דוד", relayOn: true, connectivity: "ONLINE" };
const salon: MenuDevice = { deviceId: "light-salon", name: "תאורה בסלון", relayOn: false, connectivity: "ONLINE" };
const home = [ac, sun, boiler, salon];

const noon = new Date("2026-11-22T10:00:00.000Z");

function clock(sentence: string, now = noon, devices = home) {
  return parseVoiceCommand(sentence, devices, now);
}

test("the five spoken clocks land on the Israel date and hours", () => {
  const today = clock("היום בשש בערב תפעיל דוד שמש למשך 45 דקות.");
  assert.equal(today.kind, "clock");
  if (today.kind !== "clock") return;
  assert.equal(today.device.deviceId, "sun");
  assert.equal(today.day, "2026-11-22");
  assert.equal(today.onTime, "18:00");
  assert.equal(today.offTime, "18:45");
  assert.equal(jerusalemInstant(today.day, today.onTime)?.toISOString(), "2026-11-22T16:00:00.000Z");

  const range = clock("מחר בשמונה בבוקר שידלק המזגן עד שתיים בצהריים.");
  assert.equal(range.kind, "clock");
  if (range.kind !== "clock") return;
  assert.equal(range.device.deviceId, "ac");
  assert.equal(range.day, "2026-11-23");
  assert.equal(range.onTime, "08:00");
  assert.equal(range.offTime, "14:00");
  assert.equal(
    range.speech,
    "לתזמון המזגן למחר משמונה בבוקר עד שתיים בצהריים, הקישו 1 לאישור או 2 לביטול",
  );

  const hours = clock("מחר בעשר בבוקר תדליק את המזגן לשלוש שעות.");
  assert.equal(hours.kind, "clock");
  if (hours.kind !== "clock") return;
  assert.equal(hours.day, "2026-11-23");
  assert.equal(hours.onTime, "10:00");
  assert.equal(hours.offTime, "13:00");

  const thursday = clock("ביום חמישי בשבע בערב תדליק את הדוד עד תשע וחצי.", noon, [boiler, ac]);
  assert.equal(thursday.kind, "clock");
  if (thursday.kind !== "clock") return;
  assert.equal(thursday.device.deviceId, "boiler");
  assert.equal(thursday.day, "2026-11-26");
  assert.equal(thursday.onTime, "19:00");
  assert.equal(thursday.offTime, "21:30");

  const night = clock("מחר בשמונה בבוקר תפעיל את המזגן עד עשר בלילה.");
  assert.equal(night.kind, "clock");
  if (night.kind !== "clock") return;
  assert.equal(night.day, "2026-11-23");
  assert.equal(night.onTime, "08:00");
  assert.equal(night.offTime, "22:00");
});

test("relative days, weekdays, fractions, and ranges keep the same clock", () => {
  const later = clock("מחרתיים בשמונה בבוקר תתחיל להפעיל את המזגן לשעה וחצי");
  assert.equal(later.kind, "clock");
  if (later.kind !== "clock") return;
  assert.equal(later.day, "2026-11-24");
  assert.equal(later.onTime, "08:00");
  assert.equal(later.offTime, "09:30");

  const quarter = clock("מחר ברבע לתשע בערב תפעיל את המזגן לשעה");
  assert.equal(quarter.kind, "clock");
  if (quarter.kind !== "clock") return;
  assert.equal(quarter.onTime, "20:45");
  assert.equal(quarter.offTime, "21:45");

  const long = clock("מחר בשמונה בבוקר תפעיל את המזגן למשך שעתיים ושלושת רבעי שעה");
  assert.equal(long.kind, "clock");
  if (long.kind !== "clock") return;
  assert.equal(long.onTime, "08:00");
  assert.equal(long.offTime, "10:45");

  const afternoon = clock("מחר בשתיים אחר הצהריים תפעיל את המזגן לשעה");
  assert.equal(afternoon.kind, "clock");
  if (afternoon.kind !== "clock") return;
  assert.equal(afternoon.onTime, "14:00");
  assert.equal(afternoon.offTime, "15:00");

  const fromUntil = clock("מחר משמונה עד שתיים בצהריים תפעיל את המזגן");
  assert.equal(fromUntil.kind, "clock");
  if (fromUntil.kind !== "clock") return;
  assert.equal(fromUntil.onTime, "08:00");
  assert.equal(fromUntil.offTime, "14:00");

  const bare = clock("מחר משמונה עד שתיים תפעיל את המזגן");
  assert.equal(bare.kind, "clarify");
  if (bare.kind !== "clarify") return;
  assert.match(bare.speech, /בבוקר או בערב/);
});

test("a clock that crosses midnight stores the off time for the next day", () => {
  const parsed = clock("היום בשמונה בערב תפעיל את המזגן עד שתיים בלילה");
  assert.equal(parsed.kind, "clock");
  if (parsed.kind !== "clock") return;
  assert.equal(parsed.day, "2026-11-22");
  assert.equal(parsed.onTime, "20:00");
  assert.equal(parsed.offTime, "02:00");
  assert.match(parsed.speech, /למחרת/);
  assert.equal(jerusalemInstant(shiftDate(parsed.day, 1), parsed.offTime)?.toISOString(), "2026-11-23T00:00:00.000Z");
});

test("a time that already passed is not moved to another day", () => {
  const evening = new Date("2026-11-22T16:30:00.000Z");
  const parsed = clock("היום בשש בערב תפעיל את המזגן לשעה", evening);
  assert.equal(parsed.kind, "clarify");
  if (parsed.kind !== "clarify") return;
  assert.match(parsed.speech, /כבר עברה/);

  const lateThursday = new Date("2026-11-26T18:00:00.000Z");
  const next = clock("ביום חמישי בשבע בערב תדליק את הדוד עד תשע וחצי", lateThursday, [boiler]);
  assert.equal(next.kind, "clock");
  if (next.kind !== "clock") return;
  assert.equal(next.day, "2026-12-03");
  assert.equal(next.onTime, "19:00");
});

test("summer and winter clocks use the Israel offset, including the changeover", () => {
  const beforeChange = new Date("2026-03-26T10:00:00.000Z");
  const summer = clock("מחר בשמונה בבוקר תפעיל את המזגן עד שתיים בצהריים", beforeChange);
  assert.equal(summer.kind, "clock");
  if (summer.kind !== "clock") return;
  assert.equal(summer.day, "2026-03-27");
  assert.equal(jerusalemInstant(summer.day, summer.onTime)?.toISOString(), "2026-03-27T05:00:00.000Z");

  const changeMorning = new Date("2026-03-26T22:00:00.000Z");
  const changed = clock("היום בשש בבוקר תפעיל את המזגן לשעה", changeMorning);
  assert.equal(changed.kind, "clock");
  if (changed.kind !== "clock") return;
  assert.equal(changed.day, "2026-03-27");
  assert.equal(jerusalemInstant(changed.day, changed.onTime)?.toISOString(), "2026-03-27T03:00:00.000Z");

  const winterMorning = new Date("2026-10-25T06:00:00.000Z");
  const winter = clock("היום בשש בערב תפעיל את המזגן לשעה", winterMorning);
  assert.equal(winter.kind, "clock");
  if (winter.kind !== "clock") return;
  assert.equal(winter.day, "2026-10-25");
  assert.equal(jerusalemInstant(winter.day, winter.onTime)?.toISOString(), "2026-10-25T16:00:00.000Z");
});

test("an unclear device, date, or hour asks instead of guessing, and immediate commands stay immediate", () => {
  const tie = clock("ביום חמישי בשבע בערב תדליק את הדוד עד תשע וחצי");
  assert.equal(tie.kind, "clarify");
  if (tie.kind !== "clarify") return;
  assert.match(tie.speech, /השם המדויק/);

  const missing = clock("מחר בשמונה בבוקר תפעיל עד שתיים בצהריים");
  assert.equal(missing.kind, "clarify");
  if (missing.kind !== "clarify") return;
  assert.match(missing.speech, /איזה התקן/);

  const noEnd = clock("מחר בשמונה בבוקר תפעיל את המזגן");
  assert.equal(noEnd.kind, "clarify");
  if (noEnd.kind !== "clarify") return;
  assert.match(noEnd.speech, /מתי לכבות/);

  assert.equal(clock("תדליק את הדוד לחצי שעה", noon, [boiler]).kind, "timer");
  assert.equal(clock("תדליק את האור בסלון").kind, "on");
  assert.equal(clock("כבה את הדוד", noon, [boiler]).kind, "off");
});

test("star asks for 1 before saving a one-time clock, and 2 cancels it", async () => {
  const tenant = await createTenant({ name: "בדיקת שעון קולי", phone: "035559933" });
  await createDevice({ deviceId: "voiceclockce33", name: "מזגן", tenantId: tenant.id });
  let script = "מחר בשמונה בבוקר תפעיל את המזגן עד שתיים בצהריים";
  setVoicePorts({
    load: async () => new Uint8Array([1, 2, 3, 4]),
    transcribe: async () => script,
    remove: async () => {},
  });
  const day = shiftDate(israelDate(), 1);
  const post = (fields: Record<string, string>) =>
    handleMenu(
      new Request("http://127.0.0.1/api/ivr/menu", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ApiPhone: "035559933", ...fields }),
      }),
    );
  try {
    const asked = await post({ pikud_device: "*", ApiCallId: "clock-ask", pikud_v1: "/6/clock.wav" });
    const askedText = await asked.text();
    assert.match(askedText, /לתזמון המזגן למחר משמונה בבוקר עד שתיים בצהריים/);
    assert.match(askedText, /הקישו 1 לאישור או 2 לביטול/);
    assert.match(askedText, /pikud_v2,no,1,1,/);
    assert.equal(askedText.includes("נשמר"), false);
    assert.equal((await listDayClocks(tenant.id)).length, 0);

    const cancelled = await post({
      pikud_device: "*",
      ApiCallId: "clock-ask",
      pikud_v1: "/6/clock.wav",
      pikud_v2: "2",
    });
    assert.match(await cancelled.text(), /התזמון בוטל/);
    assert.equal((await listDayClocks(tenant.id)).length, 0);

    const again = await post({ pikud_device: "*", ApiCallId: "clock-save", pikud_v1: "/6/clock2.wav" });
    assert.match(await again.text(), /הקישו 1 לאישור/);
    const saved = await post({
      pikud_device: "*",
      ApiCallId: "clock-save",
      pikud_v1: "/6/clock2.wav",
      pikud_v2: "1",
    });
    const savedText = await saved.text();
    assert.match(savedText, /נשמר שעון למזגן/);
    assert.match(savedText, /שמונה בבוקר/);
    assert.match(savedText, /שתיים בצהריים/);
    const created = await listDayClocks(tenant.id);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.day, day);
    assert.equal(created[0]?.onTime, "08:00");
    assert.equal(created[0]?.offTime, "14:00");
    assert.deepEqual(created[0]?.deviceIds, ["voiceclockce33"]);
    const onAt = jerusalemInstant(day, "08:00")?.toISOString();
    const offAt = jerusalemInstant(day, "14:00")?.toISOString();
    const database = new DatabaseSync(".data/pikud.sqlite", { readOnly: true });
    const runs = database
      .prepare(
        `SELECT action, run_at FROM program_runs
         WHERE device_id = ? AND program_id = ? AND done_at IS NULL`,
      )
      .all("voiceclockce33", `loose:${tenant.id}`) as Array<{ action: string; run_at: string }>;
    database.close();
    assert.equal(runs.some((run) => run.action === "ON" && run.run_at === onAt), true);
    assert.equal(runs.some((run) => run.action === "OFF" && run.run_at === offAt), true);
  } finally {
    for (const item of await listDayClocks(tenant.id)) await deleteDayClock(tenant.id, item.id);
    await syncTenantPrograms(tenant.id);
    await deleteDevice("voiceclockce33");
    await deleteTenant(tenant.id);
    setVoicePorts(null);
  }
});
