import assert from "node:assert/strict";
import test from "node:test";
import { devicesForPhone } from "../lib/access";
import { decideMenu, type MenuDevice } from "../lib/ivr/flow";
import { handleMenu } from "../lib/ivr/menu";
import { speakPhone } from "../lib/ivr/settings";
import { resetStatusChecks } from "../lib/ivr/status-check";
import { cleanYemotText, yemotRead } from "../lib/ivr/yemot";
import { handleIvr } from "../lib/ivr/handle";
import { syncTenantPrograms } from "../lib/programs/sync";
import {
  createDevice,
  createTenant,
  deleteDayClock,
  deleteDevice,
  deleteTenant,
  getDevice,
  listCallerNumbers,
  listDayClocks,
  listIvrTargets,
  removeCallerNumber,
  setDeviceFrozen,
  updateDeviceState,
} from "../lib/store";
import { israelDate, nextJerusalemClock } from "../lib/time";

const ac: MenuDevice = { deviceId: "ac", name: "מזגן", relayOn: false, connectivity: "ONLINE" };
const light: MenuDevice = { deviceId: "light", name: "תאורה", relayOn: true, connectivity: "ONLINE" };

test("a caller only hears sockets stored on that phone number", () => {
  const sockets = [
    { phone: "0521111111", name: "מזגן" },
    { phone: "0521111111", name: "תאורה" },
    { phone: "0532222222", name: "דוד" },
  ];
  assert.deepEqual(
    devicesForPhone(sockets, "972521111111").map((item) => item.name),
    ["מזגן", "תאורה"],
  );
  assert.deepEqual(devicesForPhone(sockets, "0532222222").map((item) => item.name), ["דוד"]);
  assert.equal(devicesForPhone(sockets, "0500000000").length, 0);
  assert.equal(devicesForPhone(sockets, undefined).length, 0);
});

test("reads the sockets and then the action that matches the relay", () => {
  const list = decideMenu([ac, light], {});
  assert.equal(list.type, "read");
  if (list.type !== "read") return;
  assert.match(list.message, /למזגן הקש אחד/);
  assert.match(list.message, /לתאורה הקש שתיים/);
  assert.match(list.message, /ולהגדרות הקש אפס/);
  assert.equal(list.message.includes(", להגדרות"), false);
  assert.equal(list.allowed, "012");
  const spoken = yemotRead(list);
  assert.equal(spoken.startsWith("read=t-"), true);
  assert.equal(spoken.includes("=&"), false);
  assert.match(spoken, /,No,/);
  assert.equal(cleanYemotText("שקע-אולם. דולק"), "שקע אולם, דולק");

  const off = decideMenu([ac, light], { device: "1" });
  assert.equal(off.type, "read");
  if (off.type !== "read") return;
  assert.match(off.message, /כבוי כעת, להפעלה הקש אחד/);
  assert.match(off.message, /לטיימר הקש שתיים/);
  assert.match(off.message, /לשעון הקש שלוש/);
  assert.match(off.message, /לתוכניות הקש ארבע/);
  assert.equal(off.message.includes("לכיבוי הקש"), false);
  assert.equal(off.allowed, "1234");
  assertMenuOptions(off.message);

  const on = decideMenu([ac, light], { device: "2" });
  assert.equal(on.type, "read");
  if (on.type !== "read") return;
  assert.match(on.message, /פועל כעת, לכיבוי הקש אחד/);
  assert.match(on.message, /לטיימר הקש שתיים/);
  assert.equal(on.message.includes("להפעלה הקש אחד"), false);
  assert.equal(on.allowed, "1234");
  assertMenuOptions(on.message);

  assert.deepEqual(decideMenu([ac], { device: "1", action: "1" }), { type: "turn", device: ac, action: "ON" });
  assert.deepEqual(decideMenu([light], { device: "1", action: "1" }), { type: "turn", device: light, action: "OFF" });
});

function assertMenuOptions(message: string) {
  const words = ["אחד", "שתיים", "שלוש", "ארבע"];
  const indexes = words.map((word) => message.indexOf(`הקש ${word}`));
  for (let place = 0; place < words.length; place += 1) {
    assert.ok(indexes[place] > (indexes[place - 1] ?? -1));
    const token = `הקש ${words[place]}`;
    assert.equal(message.indexOf(token), message.lastIndexOf(token));
  }
}

function readSlots(body: string): string[] {
  const line = body.trim().split("\n").find((item) => item.startsWith("read=")) ?? body.trim();
  return line.slice(line.lastIndexOf("=") + 1).split(",");
}

function playbackAt(body: string): string {
  return readSlots(body)[5] ?? "";
}

function assertKeypress(body: string, expected: { field: string; max: string; min: string; playback: string }) {
  const slots = readSlots(body);
  assert.equal(slots[0], expected.field);
  assert.equal(slots[2], expected.max);
  assert.equal(slots[3], expected.min);
  assert.equal(slots[5], expected.playback);
  assert.equal(slots[14], "no");
}

test("timer turns on for the requested minutes and the clock accepts four digits", () => {
  const ask = decideMenu([ac], { device: "1", action: "2" });
  assert.equal(ask.type, "read");
  if (ask.type === "read") assert.equal(ask.field, "pikud_minutes");

  const timer = decideMenu([ac], { device: "1", action: "2", minutes: "15" });
  assert.deepEqual(timer, { type: "timer", device: ac, minutes: 15 });
  assert.equal(decideMenu([ac], { device: "1", action: "2", minutes: "0" }).type, "read");
  assert.equal(decideMenu([ac], { device: "1", action: "2", minutes: "999" }).type, "read");

  const repeat = decideMenu([ac], { device: "1", action: "3" });
  assert.equal(repeat.type, "read");
  if (repeat.type === "read") {
    assert.equal(repeat.field, "pikud_repeat");
    assert.equal(repeat.allowed, "12345");
    assert.match(repeat.message, /לשעון להיום הקש אחד/);
    assert.match(repeat.message, /לתאריך מסוים הקש שתיים/);
    assert.match(repeat.message, /לכל יום הקש שלוש/);
    assert.match(repeat.message, /לכל יום חוץ משישי ושבת הקש ארבע/);
    assert.match(repeat.message, /לבחירת ימים הקש חמש/);
  }

  const today = decideMenu([ac], { device: "1", action: "3", repeat: "1" });
  assert.equal(today.type, "read");
  if (today.type === "read") {
    assert.equal(today.field, "pikud_side");
    assert.equal(today.message.includes("שמונה ספרות"), false);
    assert.equal(today.message.includes("pikud_date"), false);
    assert.match(today.message, /שעון להיום/);
  }
  const todaySaved = decideMenu([ac], { device: "1", action: "3", repeat: "1", side: "1", on: "1100", more: "2" });
  assert.equal(todaySaved.type, "clock-save");
  if (todaySaved.type === "clock-save") {
    assert.equal(todaySaved.day, israelDate());
    assert.deepEqual(todaySaved.weekdays, []);
    assert.equal(todaySaved.onTime, "11:00");
    assert.equal(todaySaved.offTime, null);
  }

  const saved = decideMenu([ac], { device: "1", action: "3", repeat: "4", side: "1", on: "1000", more: "1", off: "1200" });
  assert.equal(saved.type, "clock-save");
  if (saved.type === "clock-save") {
    assert.deepEqual(saved.weekdays, [0, 1, 2, 3, 4]);
    assert.equal(saved.onTime, "10:00");
    assert.equal(saved.offTime, "12:00");
    assert.deepEqual(saved.devices.map((item) => item.deviceId), ["ac"]);
  }
  const custom = decideMenu([ac], { device: "1", action: "3", repeat: "5", week: "15", side: "1", on: "2200", more: "1", off: "0600" });
  assert.equal(custom.type, "clock-save");
  if (custom.type === "clock-save") {
    assert.deepEqual(custom.weekdays, [0, 4]);
    assert.equal(custom.onTime, "22:00");
    assert.equal(custom.offTime, "06:00");
  }
  const once = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "03112026", side: "2", off: "1800", more: "2" });
  assert.equal(once.type, "clock-save");
  if (once.type === "clock-save") {
    assert.equal(once.day, "2026-11-03");
    assert.equal(once.onTime, null);
    assert.equal(once.offTime, "18:00");
  }
  const invalidTime = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "03112026", side: "1", on: "1860" });
  assert.equal(invalidTime.type, "read");
  if (invalidTime.type === "read") {
    assert.equal(invalidTime.field, "pikud_on");
    assert.equal(invalidTime.mode, "No");
    assert.match(invalidTime.message, /השעה לא תקינה/);
  }
  const notSkip = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "03112026", side: "1", on: "9999", more: "2" });
  assert.equal(notSkip.type, "read");
  if (notSkip.type === "read") {
    assert.equal(notSkip.field, "pikud_on");
    assert.equal(notSkip.message.includes("תשע תשע תשע תשע"), false);
  }
  const heard = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "11112026" });
  assert.equal(heard.type, "read");
  if (heard.type === "read") {
    assert.equal(heard.field, "pikud_side");
    assert.match(heard.message, /נקלט אחד עשר בנובמבר אלפיים עשרים ושש, יום רביעי/);
    assert.equal(heard.message.includes("11112026"), false);
    assert.match(heard.message, /להגדרת הדלקה הקש אחד, להגדרת כיבוי הקש שתיים/);
    const menu = decideMenu([ac], { device: "1" });
    assert.equal(menu.type, "read");
    if (menu.type === "read") assert.equal(playbackAt(yemotRead(heard)), playbackAt(yemotRead(menu)));
    assert.equal(playbackAt(yemotRead(heard)), "No");
  }
  const saturday = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "07112026" });
  assert.equal(saturday.type, "read");
  if (saturday.type === "read") assert.match(saturday.message, /נקלט שבעה בנובמבר אלפיים עשרים ושש, שבת/);
  const atEleven = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "11112026", side: "1", on: "1100" });
  assert.equal(atEleven.type, "read");
  if (atEleven.type === "read") {
    assert.equal(atEleven.field, "pikud_more");
    assert.match(atEleven.message, /נקלטה שעת הדלקה אחת עשרה בבוקר/);
    assert.equal(atEleven.message.includes("1100"), false);
    assert.equal(atEleven.message.includes("אלף"), false);
    assert.equal(playbackAt(yemotRead(atEleven)), "No");
  }
  const daily = decideMenu([ac], { device: "1", action: "3", repeat: "3" });
  assert.equal(daily.type, "read");
  if (daily.type === "read") {
    assert.equal(daily.field, "pikud_side");
    assert.equal(daily.message, "להגדרת הדלקה הקש אחד, להגדרת כיבוי הקש שתיים");
    assert.equal(daily.message.includes("9999"), false);
  }
  const dailyOn = decideMenu([ac], { device: "1", action: "3", repeat: "3", side: "1", on: "1000", more: "2" });
  assert.equal(dailyOn.type, "clock-save");
  if (dailyOn.type === "clock-save") {
    assert.equal(dailyOn.onTime, "10:00");
    assert.equal(dailyOn.offTime, null);
    assert.deepEqual(dailyOn.weekdays, [0, 1, 2, 3, 4, 5, 6]);
  }
  const offThenOn = decideMenu([ac], {
    device: "1",
    action: "3",
    repeat: "2",
    date: "03112026",
    side: "2",
    off: "1800",
    more: "1",
    on: "1000",
  });
  assert.equal(offThenOn.type, "clock-save");
  if (offThenOn.type === "clock-save") {
    assert.equal(offThenOn.onTime, "10:00");
    assert.equal(offThenOn.offTime, "18:00");
  }
  const askDate = decideMenu([ac], { device: "1", action: "3", repeat: "2" });
  assert.equal(askDate.type, "read");
  if (askDate.type === "read") {
    assert.equal(askDate.field, "pikud_date");
    assert.equal(askDate.min, 8);
    assert.equal(askDate.max, 8);
    assert.equal(askDate.mode, "No");
    assert.equal(askDate.seconds, 8);
    assert.equal(askDate.allowEmpty, true);
    const menu = decideMenu([ac], { device: "1" });
    if (menu.type === "read") assert.equal(playbackAt(yemotRead(askDate)), playbackAt(yemotRead(menu)));
    assertKeypress(yemotRead(askDate), { field: "pikud_date", max: "8", min: "8", playback: "No" });
    assert.equal(
      askDate.message,
      "הקש שמונה ספרות, שתיים ליום, שתיים לחודש, וארבע ספרות לשנה. לשלושה בנובמבר אלפיים עשרים ושש הקש אפס שלוש אחד אחד שתיים אפס שתיים שש",
    );
  }
  const askTime = decideMenu([ac], { device: "1", action: "3", repeat: "3", side: "1" });
  assert.equal(askTime.type, "read");
  if (askTime.type === "read") {
    assert.equal(askTime.field, "pikud_on");
    assert.equal(askTime.min, 4);
    assert.equal(askTime.max, 4);
    assertKeypress(yemotRead(askTime), { field: "pikud_on", max: "4", min: "4", playback: "No" });
  }
  const badDay = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "31022026" });
  assert.equal(badDay.type, "read");
  if (badDay.type === "read") assert.match(badDay.message, /היום לא קיים בחודש הזה/);
  const badMonth = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "03132026" });
  assert.equal(badMonth.type, "read");
  if (badMonth.type === "read") assert.match(badMonth.message, /החודש לא תקין/);
  const shortDate = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "031126" });
  assert.equal(shortDate.type, "read");
  if (shortDate.type === "read") assert.match(shortDate.message, /חסרות ספרות/);
  const missingDate = decideMenu([ac], { device: "1", action: "3", repeat: "2", date: "" });
  assert.equal(missingDate.type, "read");
  if (missingDate.type === "read") assert.match(missingDate.message, /לא הוקש תאריך/);
  const both = decideMenu([ac, light], { device: "1", action: "3", repeat: "3", side: "1", on: "1000", more: "1", off: "1200" });
  assert.equal(both.type, "read");
  if (both.type === "read") assert.equal(both.field, "pikud_sockets");

  const turnOn = decideMenu([ac], { device: "1", action: "1" });
  assert.equal(turnOn.type, "turn");
  if (turnOn.type === "turn") assert.equal(turnOn.action, "ON");
  const turnOff = decideMenu([light], { device: "1", action: "1" });
  assert.equal(turnOff.type, "turn");
  if (turnOff.type === "turn") assert.equal(turnOff.action, "OFF");
  const timerAsk = decideMenu([ac], { device: "1", action: "2" });
  assert.equal(timerAsk.type, "read");
  if (timerAsk.type === "read") assert.equal(timerAsk.field, "pikud_minutes");
  const clockAsk = decideMenu([ac], { device: "1", action: "3" });
  assert.equal(clockAsk.type, "read");
  if (clockAsk.type === "read") assert.equal(clockAsk.field, "pikud_repeat");
  const unknown = decideMenu([{ ...ac, relayOn: null }], { device: "1", action: "1" });
  assert.equal(unknown.type, "turn");
  if (unknown.type === "turn") assert.equal(unknown.action, "ON");
  const rejected = decideMenu([light], { device: "1", action: "9" });
  assert.equal(rejected.type, "read");
  if (rejected.type === "read") assert.match(rejected.message, /הבחירה לא קיימת/);
});

test("the phone menu does not ask for a token", async () => {
  const response = await handleMenu(
    new Request("http://127.0.0.1/api/ivr/menu", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ApiPhone: "0500000000" }),
    }),
  );
  const text = await response.text();
  assert.equal(text.includes("אין הרשאה"), false);
  assert.match(text, /המספר הזה לא משויך לשקע/);
});

test("a call from yemot does not need our token", async () => {
  const response = await handleMenu(
    new Request("http://127.0.0.1/api/ivr/menu", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "yemot-core-api/1.0",
      },
      body: new URLSearchParams({ ApiPhone: "0500000000" }),
    }),
  );
  const text = await response.text();
  assert.equal(text.includes("אין הרשאה"), false);
  assert.match(text, /המספר הזה לא משויך לשקע/);
});

test("a caller can correct a full date and an empty date asks again", async () => {
  const entered = {
    ApiPhone: "035551001",
    pikud_device: "1",
    pikud_action: "3",
    pikud_repeat: "2",
  };
  const ask = await phonePress(entered);
  const askText = await ask.text();
  assert.match(askText, /אפס שלוש אחד אחד שתיים אפס שתיים שש/);
  assert.match(askText, /pikud_date,no,8,8,8,No,yes,,/);
  assertKeypress(askText, { field: "pikud_date", max: "8", min: "8", playback: "No" });
  assert.equal(askText.includes(",Number,"), false);
  assert.equal(askText.includes(",Digits,"), false);
  assert.equal(askText.includes("go_to_folder=hangup"), false);

  const impossible = await phonePress({ ...entered, pikud_date: "31022026" });
  const impossibleText = await impossible.text();
  assert.match(impossibleText, /היום לא קיים בחודש הזה/);
  assert.match(impossibleText, /pikud_date,no,8,8,8,No,yes,,/);
  assert.equal(playbackAt(impossibleText), "No");
  assert.equal(impossibleText.includes("go_to_folder=hangup"), false);

  const short = await phonePress({ ...entered, pikud_date: "031126" });
  const shortText = await short.text();
  assert.match(shortText, /חסרות ספרות/);
  assert.match(shortText, /pikud_date,no,8,8,8,No,yes,,/);

  const empty = await phonePress({ ...entered, pikud_date: "" });
  const emptyText = await empty.text();
  assert.match(emptyText, /לא הוקש תאריך/);
  assert.match(emptyText, /pikud_date,no,8,8,8,No,yes,,/);
  assert.equal(emptyText.includes("go_to_folder=hangup"), false);

  const none = await phonePress({ ...entered, pikud_date: "None" });
  assert.match(await none.text(), /לא הוקש תאריך/);

  const corrected = await phonePress({ ...entered, pikud_date: "03112026" });
  const correctedText = await corrected.text();
  assert.match(correctedText, /נקלט שלושה בנובמבר אלפיים עשרים ושש, יום שלישי/);
  assert.match(correctedText, /להגדרת הדלקה הקש אחד, להגדרת כיבוי הקש שתיים/);
  assert.match(correctedText, /pikud_side,no,1,1,8,No,yes,,,12,/);
  assert.equal(correctedText.includes("pikud_date"), false);
  assert.equal(correctedText.includes("pikud_on"), false);
  assert.equal(correctedText.includes("תשע תשע תשע תשע"), false);
  assert.equal(correctedText.includes("9999"), false);
  assert.equal(correctedText.includes("go_to_folder=hangup"), false);
  assert.equal(playbackAt(askText), playbackAt(correctedText));
});

test("a one-time clock speaks the date and saves the chosen on or off time", async () => {
  const base = {
    ApiPhone: "035551002",
    pikud_device: "1",
    pikud_action: "3",
    pikud_repeat: "2",
    pikud_date: "03112026",
  };
  const heard = await phonePress(base);
  const heardText = await heard.text();
  assert.match(heardText, /נקלט שלושה בנובמבר אלפיים עשרים ושש, יום שלישי/);
  assert.match(heardText, /להגדרת הדלקה הקש אחד, להגדרת כיבוי הקש שתיים/);
  assert.match(heardText, /pikud_side,no,1,1,8,No,yes,,,12,/);
  assert.equal(heardText.includes("אפס שלוש אחד אחד"), false);
  assert.equal(heardText.includes("9999"), false);
  assert.equal(heardText.includes("תשע תשע תשע תשע"), false);
  assert.equal(heardText.includes("go_to_folder=hangup"), false);

  const again = await phonePress({ ...base, pikud_side: "9" });
  const againText = await again.text();
  assert.match(againText, /הבחירה לא קיימת, להגדרת הדלקה הקש אחד, להגדרת כיבוי הקש שתיים/);
  assert.match(againText, /pikud_side,/);
  assert.equal(againText.includes("go_to_folder=hangup"), false);

  const onAsk = await phonePress({ ...base, pikud_side: "1" });
  const onAskText = await onAsk.text();
  assert.match(onAskText, /pikud_on,no,4,4,/);
  assertKeypress(onAskText, { field: "pikud_on", max: "4", min: "4", playback: "No" });
  assert.equal(playbackAt(onAskText), playbackAt(heardText));
  assert.match(onAskText, /לשעת הדלקה הקש ארבע ספרות/);
  assert.equal(onAskText.includes("תשע תשע תשע תשע"), false);
  assert.equal(onAskText.includes("9999"), false);
  assert.equal(onAskText.includes("go_to_folder=hangup"), false);

  const afterOn = await phonePress({ ...base, pikud_side: "1", pikud_on: "1100" });
  const afterOnText = await afterOn.text();
  assert.match(afterOnText, /נקלטה שעת הדלקה אחת עשרה בבוקר/);
  assert.equal(afterOnText.includes("1100"), false);
  assert.equal(afterOnText.includes("אלף"), false);
  assert.equal(afterOnText.includes(",Number,"), false);
  assert.equal(afterOnText.includes(",Digits,"), false);
  assert.match(afterOnText, /להמשך להגדרת כיבוי הקש אחד, לסיום הקש שתיים/);
  assert.match(afterOnText, /pikud_more,no,1,1,8,No,yes,,,12,/);
  assert.equal(afterOnText.includes("go_to_folder=hangup"), false);

  const moreAgain = await phonePress({ ...base, pikud_side: "1", pikud_on: "1000", pikud_more: "5" });
  const moreAgainText = await moreAgain.text();
  assert.match(moreAgainText, /הבחירה לא קיימת, להמשך להגדרת כיבוי הקש אחד, לסיום הקש שתיים/);
  assert.equal(moreAgainText.includes("go_to_folder=hangup"), false);

  const skipped = await phonePress({ ...base, pikud_side: "1", pikud_on: "9999", pikud_more: "2" });
  const skippedText = await skipped.text();
  assert.match(skippedText, /השעה לא תקינה/);
  assert.match(skippedText, /pikud_on,no,4,4,/);
  assert.equal(skippedText.includes("נשמר"), false);
  assert.equal(skippedText.includes("תשע תשע תשע תשע"), false);
  assert.equal(skippedText.includes("go_to_folder=hangup"), false);

  const offAsk = await phonePress({ ...base, pikud_side: "2" });
  const offAskText = await offAsk.text();
  assert.match(offAskText, /pikud_off,no,4,4,/);
  assertKeypress(offAskText, { field: "pikud_off", max: "4", min: "4", playback: "No" });
  assert.match(offAskText, /לשעת כיבוי הקש ארבע ספרות/);
  assert.equal(offAskText.includes("תשע תשע תשע תשע"), false);

  const afterOff = await phonePress({ ...base, pikud_side: "2", pikud_off: "1800" });
  const afterOffText = await afterOff.text();
  assert.match(afterOffText, /נקלטה שעת כיבוי שש בערב/);
  assert.equal(afterOffText.includes("1800"), false);
  assert.match(afterOffText, /להמשך להגדרת הדלקה הקש אחד, לסיום הקש שתיים/);
  assert.equal(afterOffText.includes("go_to_folder=hangup"), false);

  await expectClock({ ...base, pikud_side: "1", pikud_on: "1000", pikud_more: "2" }, "10:00", null, /הדלקה עשר בבוקר/);
  await expectClock(
    { ...base, pikud_side: "1", pikud_on: "1000", pikud_more: "1", pikud_off: "1800" },
    "10:00",
    "18:00",
    /הדלקה עשר בבוקר, כיבוי שש בערב/,
  );
  await expectClock({ ...base, pikud_side: "2", pikud_off: "1830", pikud_more: "2" }, null, "18:30", /כיבוי שש וחצי בערב/);
  await expectClock(
    { ...base, pikud_side: "2", pikud_off: "1830", pikud_more: "1", pikud_on: "0700" },
    "07:00",
    "18:30",
    /הדלקה שבע בבוקר, כיבוי שש וחצי בערב/,
  );

  const dated = await phonePress({ ...base, pikud_date: "11112026" });
  const datedText = await dated.text();
  assert.match(datedText, /נקלט אחד עשר בנובמבר אלפיים עשרים ושש, יום רביעי/);
  assert.equal(datedText.includes("11112026"), false);
  assert.equal(datedText.includes(",Digits,"), false);
  assert.equal(datedText.includes(",Number,"), false);
  assert.equal(playbackAt(datedText), "No");

  const weekday = await phonePress({ ApiPhone: "035551002", pikud_device: "1", pikud_action: "3", pikud_repeat: "4" });
  const weekdayText = await weekday.text();
  assert.match(weekdayText, /להגדרת הדלקה הקש אחד, להגדרת כיבוי הקש שתיים/);
  assert.equal(weekdayText.includes("9999"), false);
  assert.equal(weekdayText.includes("תשע תשע תשע תשע"), false);
  assert.equal(weekdayText.includes("go_to_folder=hangup"), false);
});

test("option 4 then 1 saves today's Jerusalem date and does not ask for one", async () => {
  const ask = await phonePress({ ApiPhone: "035551002", pikud_device: "1", pikud_action: "3", pikud_repeat: "1" });
  const askText = await ask.text();
  assert.equal(askText.includes("pikud_date"), false);
  assert.equal(askText.includes("שמונה ספרות"), false);
  assert.match(askText, /שעון להיום/);
  assert.match(askText, /pikud_side,/);
  assert.equal(askText.includes("go_to_folder=hangup"), false);

  const before = new Set((await listDayClocks("ten_shul")).map((clock) => clock.id));
  try {
    const saved = await phonePress({
      ApiPhone: "035551002",
      pikud_device: "1",
      pikud_action: "3",
      pikud_repeat: "1",
      pikud_side: "1",
      pikud_on: "1100",
      pikud_more: "2",
    });
    const text = await saved.text();
    assert.match(text, /נשמר שעון לשקע תאורה/);
    assert.match(text, /אחת עשרה בבוקר/);
    assert.equal(text.includes("1100"), false);
    assert.equal(text.includes("pikud_date"), false);
    assert.match(text, /go_to_folder=hangup/);
    const created = (await listDayClocks("ten_shul")).filter((clock) => !before.has(clock.id));
    assert.equal(created.length, 1);
    assert.equal(created[0]?.day, israelDate());
    assert.equal(created[0]?.onTime, "11:00");
    assert.equal(created[0]?.offTime, null);
  } finally {
    const created = (await listDayClocks("ten_shul")).filter((clock) => !before.has(clock.id));
    for (const clock of created) await deleteDayClock("ten_shul", clock.id);
    if (created.length) await syncTenantPrograms("ten_shul");
  }
});

async function expectClock(fields: Record<string, string>, onTime: string | null, offTime: string | null, saved: RegExp) {
  const before = new Set((await listDayClocks("ten_shul")).map((clock) => clock.id));
  try {
    const response = await phonePress(fields);
    const text = await response.text();
    assert.match(text, /נשמר שעון לשקע תאורה/);
    assert.match(text, saved);
    assert.match(text, /go_to_folder=hangup/);
    assert.equal(text.includes("9999"), false);
    assert.equal("pikud_on" in fields && fields.pikud_on === "9999", false);
    assert.equal("pikud_off" in fields && fields.pikud_off === "9999", false);
    if (!onTime) assert.equal(text.includes("הדלקה"), false);
    if (!offTime) assert.equal(text.includes("כיבוי"), false);
    const created = (await listDayClocks("ten_shul")).filter((clock) => !before.has(clock.id));
    assert.equal(created.length, 1);
    assert.equal(created[0]?.onTime, onTime);
    assert.equal(created[0]?.offTime, offTime);
    assert.equal(created[0]?.day, "2026-11-03");
  } finally {
    const created = (await listDayClocks("ten_shul")).filter((clock) => !before.has(clock.id));
    for (const clock of created) await deleteDayClock("ten_shul", clock.id);
    if (created.length) await syncTenantPrograms("ten_shul");
  }
}

test("a hangup resend does not open the menu again", async () => {
  const body = new URLSearchParams({
    token: "dev-ivr-7f3a",
    hangup: "yes",
    ApiPhone: "035551001",
    pikud_device: "1",
    pikud_action: "1",
  });
  const response = await handleMenu(
    new Request("http://127.0.0.1/api/ivr/menu", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
  assert.equal(await response.text(), "noop=hangup\n");
});

function phonePress(fields: Record<string, string>) {
  // Drop cached status fetches unless this is the follow-up after the wait line.
  if (!Object.hasOwn(fields, "pikud_ready")) resetStatusChecks();
  return handleMenu(
    new Request("http://127.0.0.1/api/ivr/menu", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
      body: new URLSearchParams(fields),
    }),
  );
}

async function waitForRelay(deviceId: string, relayOn: boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const device = await getDevice(deviceId);
    if (device?.relayOn === relayOn) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal((await getDevice(deviceId))?.relayOn, relayOn);
}

test("the on and off keys are answered before the socket finishes switching", async () => {
  const now = new Date().toISOString();
  await updateDeviceState("rct063285302", { connectivity: "ONLINE", relayOn: false, stateUpdatedAt: now, lastError: null });
  await updateDeviceState("rct074190118", { connectivity: "ONLINE", relayOn: true, stateUpdatedAt: now, lastError: null });
  await updateDeviceState("rct063285417", { connectivity: "OFFLINE", relayOn: false, stateUpdatedAt: now, lastError: null });

  let menu = await phonePress({ ApiPhone: "035551001", pikud_device: "1" });
  let menuText = await menu.text();
  if (menuText.includes("pikud_ready")) {
    assert.match(menuText, /מבצע בדיקת מצב ערוץ אנא המתן/);
    assert.equal(menuText.includes("להפעלה הקש אחד"), false);
    assert.equal(menuText.includes("מבצע בדיקת מצב ערוץ אנא המתן,"), false);
    // amount_attempts must be 1 — otherwise Yemot speaks the wait line twice.
    assert.match(menuText, /=pikud_ready,no,1,1,1,No,yes,,,,1,Ok,1,,no/);
    menu = await phonePress({ ApiPhone: "035551001", pikud_device: "1", pikud_ready: "1" });
    menuText = await menu.text();
  }
  assert.match(menuText, /כבוי כעת, להפעלה הקש אחד/);

  const started = Date.now();
  const on = await phonePress({ ApiPhone: "035551001", pikud_device: "1", pikud_action: "1" });
  const onText = await on.text();
  assert.ok(Date.now() - started < 1500);
  assert.match(onText, /השקע הופעל בהצלחה/);
  assert.match(onText, /go_to_folder=hangup/);
  assert.equal(onText.includes("אין הרשאה"), false);
  await waitForRelay("rct063285302", true);

  const off = await phonePress({ ApiPhone: "035551002", pikud_device: "1", pikud_action: "1" });
  const offText = await off.text();
  assert.match(offText, /השקע כובה בהצלחה/);
  await waitForRelay("rct074190118", false);

  const offline = await phonePress({ ApiPhone: "035551001", pikud_device: "2", pikud_action: "1" });
  assert.match(await offline.text(), /השקע אינו מחובר כעת/);
});

test("a frozen socket is refused on the phone and stays as it was", async () => {
  const tenant = await createTenant({ name: "לקוח הקפאה", phone: "0540001777" });
  const deviceId = "rctfreeze0001";
  try {
    await createDevice({ deviceId, name: "שקע מוקפא", tenantId: tenant.id });
    await updateDeviceState(deviceId, {
      connectivity: "ONLINE",
      relayOn: false,
      stateUpdatedAt: new Date().toISOString(),
      lastError: null,
    });
    await setDeviceFrozen(deviceId, true);

    const turn = await phonePress({ ApiPhone: "0540001777", pikud_device: "1", pikud_action: "1" });
    assert.match(await turn.text(), /השקע מוקפא/);
    const timer = await phonePress({ ApiPhone: "0540001777", pikud_device: "1", pikud_action: "2", pikud_minutes: "15" });
    assert.match(await timer.text(), /השקע מוקפא/);
    assert.equal((await getDevice(deviceId))?.relayOn, false);

    const direct = await handleIvr(
      new Request(`http://127.0.0.1/api/ivr/on?format=json&deviceId=${deviceId}`, {
        method: "POST",
        headers: { "user-agent": "yemot-core-api/1.0", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ApiPhone: "0540001777" }),
      }),
      "on",
    );
    assert.equal(direct.status, 403);
    const payload = (await direct.json()) as { outcome?: string; speech?: string };
    assert.equal(payload.outcome, "frozen");
    assert.equal(payload.speech, "השקע מוקפא");
    assert.equal((await getDevice(deviceId))?.relayOn, false);
  } finally {
    await setDeviceFrozen(deviceId, false).catch(() => undefined);
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id);
  }
});

test("a clock time that already passed is scheduled for tomorrow in Israel", () => {
  const now = new Date("2026-11-02T16:00:00.000Z");
  const later = nextJerusalemClock(19, 0, now);
  const earlier = nextJerusalemClock(17, 0, now);
  assert.equal(later.today, true);
  assert.equal(later.at.toISOString(), "2026-11-02T17:00:00.000Z");
  assert.equal(earlier.today, false);
  assert.equal(earlier.at.toISOString(), "2026-11-03T15:00:00.000Z");
});

test("settings branch adds and removes a caller number and can ask for an admin callback", async () => {
  const menu = await phonePress({ ApiPhone: "035551001", pikud_device: "0" });
  assert.match(await menu.text(), /להוספת מספר מורשה הקש אחד/);

  const ask = await phonePress({ ApiPhone: "035551001", pikud_device: "0", pikud_settings: "1" });
  const askText = await ask.text();
  assert.match(askText, /הקישו את מספר הטלפון להוספה/);
  assert.match(askText, /pikud_new_phone/);

  const added = await phonePress({
    ApiPhone: "035551001",
    pikud_device: "0",
    pikud_settings: "1",
    pikud_new_phone: "0540001999",
  });
  assert.match(await added.text(), /נוסף בהצלחה/);

  const tenantId = (await listIvrTargets()).find((device) => device.phones.includes("035551001"))?.tenantId;
  assert.ok(tenantId);
  const phones = await listCallerNumbers(tenantId!);
  const index = phones.findIndex((item) => item.phone === "0540001999");
  assert.ok(index >= 0);

  const removeMenu = await phonePress({ ApiPhone: "035551001", pikud_device: "0", pikud_settings: "2" });
  const removeText = await removeMenu.text();
  assert.match(removeText, /pikud_del_phone/);
  assert.match(removeText, new RegExp(speakPhone("0540001999")));

  const removed = await phonePress({
    ApiPhone: "035551001",
    pikud_device: "0",
    pikud_settings: "2",
    pikud_del_phone: String(index + 1),
  });
  assert.match(await removed.text(), /הוסר/);
  assert.equal((await listCallerNumbers(tenantId!)).some((item) => item.phone === "0540001999"), false);

  const confirm = await phonePress({ ApiPhone: "035551001", pikud_device: "0", pikud_settings: "4" });
  assert.match(await confirm.text(), /לשליחת פניה למנהל המערכת/);
  const sent = await phonePress({
    ApiPhone: "035551001",
    pikud_device: "0",
    pikud_settings: "4",
    pikud_admin_ask: "1",
  });
  assert.match(await sent.text(), /הפניה נשלחה למנהל המערכת/);

  const logs = await phonePress({ ApiPhone: "035551001", pikud_device: "0", pikud_settings: "3" });
  assert.match(await logs.text(), /פעולות אחרונות|אין פעולות ביומן/);

  // Cleanup if anything lingered from a previous failed run.
  for (const item of await listCallerNumbers(tenantId!)) {
    if (item.phone === "0540001999") await removeCallerNumber(tenantId!, item.id);
  }
});
