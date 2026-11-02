import assert from "node:assert/strict";
import test from "node:test";
import { devicesForPhone } from "../lib/access";
import { decideMenu, type MenuDevice } from "../lib/ivr/flow";
import { yemotRead } from "../lib/ivr/yemot";
import { nextJerusalemClock } from "../lib/time";

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
  assert.equal(list.allowed, "12");
  assert.equal(yemotRead(list).startsWith("read=t-"), true);
  assert.equal(yemotRead(list).includes("=&"), false);

  const off = decideMenu([ac, light], { device: "1" });
  assert.equal(off.type, "read");
  if (off.type !== "read") return;
  assert.match(off.message, /להפעלה הקש אחד/);
  assert.equal(off.message.includes("לכיבוי"), false);
  assert.equal(off.allowed, "134");

  const on = decideMenu([ac, light], { device: "2" });
  assert.equal(on.type, "read");
  if (on.type !== "read") return;
  assert.match(on.message, /לכיבוי הקש שתיים/);
  assert.equal(on.message.includes("להפעלה"), false);
  assert.equal(on.allowed, "234");
});

test("timer turns on for the requested minutes and the clock accepts four digits", () => {
  const ask = decideMenu([ac], { device: "1", action: "3" });
  assert.equal(ask.type, "read");
  if (ask.type === "read") assert.equal(ask.field, "pikud_minutes");

  const timer = decideMenu([ac], { device: "1", action: "3", minutes: "15" });
  assert.deepEqual(timer, { type: "timer", device: ac, minutes: 15 });
  assert.equal(decideMenu([ac], { device: "1", action: "3", minutes: "0" }).type, "read");
  assert.equal(decideMenu([ac], { device: "1", action: "3", minutes: "999" }).type, "read");

  const clock = decideMenu([ac], { device: "1", action: "4", clock: "1830" });
  assert.deepEqual(clock, { type: "clock", device: ac, hour: 18, minute: 30 });
  assert.equal(decideMenu([ac], { device: "1", action: "4", clock: "1860" }).type, "read");

  const turnOn = decideMenu([ac], { device: "1", action: "1" });
  assert.equal(turnOn.type, "turn");
  if (turnOn.type === "turn") assert.equal(turnOn.action, "ON");
  const turnOff = decideMenu([light], { device: "1", action: "2" });
  assert.equal(turnOff.type, "turn");
  if (turnOff.type === "turn") assert.equal(turnOff.action, "OFF");
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
