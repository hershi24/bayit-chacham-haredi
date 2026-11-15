import assert from "node:assert/strict";
import { test } from "node:test";
import { decideMenu, STATUS_WAIT } from "@/lib/ivr/flow";
import { demoAnswer, demoHome, type DemoTurn, type DemoValues } from "@/lib/ivr/demo";
import { settingsMenu } from "@/lib/ivr/settings-menu";

function text(turn: DemoTurn) {
  return turn.type === "read" ? turn.read.message : turn.message;
}

function call(keys: Array<[string, string]>) {
  const home = demoHome(Date.parse("2026-11-15T12:00:00Z"));
  const values: DemoValues = {};
  const heard = [text(demoAnswer(home, values))];
  for (const [field, value] of keys) {
    values[field] = value;
    heard.push(text(demoAnswer(home, values)));
  }
  return { home, heard };
}

test("demo opens with the same device list as the live line", () => {
  const home = demoHome();
  const live = decideMenu(home.devices, {});
  assert.equal(live.type, "read");
  assert.equal(text(demoAnswer(home, {})), live.type === "read" ? live.message : "");
  assert.match(text(demoAnswer(home, {})), /^לדוד שמש הקש אחד, למזגן בסלון הקש שתיים, לתאורת חצר הקש שלוש ולהגדרות הקש אפס$/);
});

test("choosing a device waits for status, then reads its menu and switches it", () => {
  const { home, heard } = call([
    ["pikud_device", "1"],
    ["pikud_ready", "1"],
    ["pikud_action", "1"],
  ]);
  assert.equal(heard[1], STATUS_WAIT);
  assert.equal(heard[2], "דוד שמש כבוי כעת, להפעלה הקש אחד, לטיימר הקש שתיים, לשעון הקש שלוש, לתוכניות הקש ארבע");
  assert.equal(heard[3], "דוד שמש הופעל בהצלחה");
  assert.equal(home.devices[0]?.relayOn, true);
});

test("timer and clock use the live wording", () => {
  const timer = call([
    ["pikud_device", "2"],
    ["pikud_ready", "1"],
    ["pikud_action", "2"],
    ["pikud_minutes", "30"],
  ]);
  assert.equal(timer.heard.at(-1), "מזגן בסלון פועל, הוא יכבה בעוד 30 דקות");

  const clock = call([
    ["pikud_device", "1"],
    ["pikud_ready", "1"],
    ["pikud_action", "3"],
    ["pikud_repeat", "3"],
    ["pikud_side", "1"],
    ["pikud_on", "0600"],
    ["pikud_more", "2"],
    ["pikud_sockets", "1"],
  ]);
  assert.match(clock.heard.at(-1) ?? "", /^נשמרה תוכנית דוד שמש/);
});

test("programs list, read every clock, and edit one", () => {
  const { heard } = call([
    ["pikud_device", "1"],
    ["pikud_ready", "1"],
    ["pikud_action", "4"],
    ["pikud_program", "1"],
    ["pikud_program_op", "2"],
    ["pikud_program_slot", "2"],
    ["pikud_side", "1"],
    ["pikud_on", "1630"],
  ]);
  assert.match(heard[3] ?? "", /^תפריט תוכניות לדוד שמש\. תוכנית אחד, דוד בוקר וערב, פעילה כעת/);
  assert.match(heard[4] ?? "", /שעון אחד, .*שעון שתיים/);
  assert.match(heard[5] ?? "", /^איזה שעון לערוך/);
  assert.equal(heard.at(-1), "תוכנית דוד בוקר וערב, שעון שתיים, שעת הדלקה עודכנה לארבע וחצי בצהריים");
});

test("zero opens the live settings menu and its actions", () => {
  const menu = call([["pikud_device", "0"]]);
  assert.equal(menu.heard[1], settingsMenu().message);

  const allOn = call([
    ["pikud_device", "0"],
    ["pikud_settings", "5"],
  ]);
  assert.equal(allOn.heard.at(-1), "כל השקעים הופעלו בהצלחה, שני שקעים");

  const remove = call([
    ["pikud_device", "0"],
    ["pikud_settings", "2"],
  ]);
  assert.match(remove.heard.at(-1) ?? "", /^למספר אפס חמש שמונה.*לביטול הקש אפס$/);

  const admin = call([
    ["pikud_device", "0"],
    ["pikud_settings", "4"],
    ["pikud_admin_ask", "1"],
  ]);
  assert.equal(admin.heard.at(-1), "הפניה נשלחה למנהל המערכת, נחזור אליכם בהקדם");
});
