import assert from "node:assert/strict";
import test from "node:test";
import { isDeviceIcon, suggestIcon } from "../lib/devices/icons";
import { timerInstants, timerMessage } from "../lib/devices/timer";
import { earliestPlan } from "../lib/devices/upcoming";
import { presentDevice } from "../lib/store-sqlite";
import { planWhen } from "../lib/time";
import type { DeviceView } from "../lib/types";

const now = new Date("2026-11-03T08:00:00.000Z");

test("the next line keeps the earliest plan for each socket", () => {
  const plans = earliestPlan([
    { deviceId: "a", at: "2026-11-03T11:30:00.000Z", action: "OFF" },
    { deviceId: "a", at: "2026-11-03T11:00:00.000Z", action: "ON" },
    { deviceId: "b", at: "2026-11-03T12:00:00.000Z", action: "OFF" },
  ]);
  assert.deepEqual(plans.get("a"), { at: "2026-11-03T11:00:00.000Z", action: "ON" });
  assert.deepEqual(plans.get("b"), { at: "2026-11-03T12:00:00.000Z", action: "OFF" });
});

test("a later timer starts at the Jerusalem clock and stops after the duration", () => {
  const later = timerInstants({ minutes: 30, start: "13:00" }, now);
  assert.equal(later.onAt, "2026-11-03T11:00:00.000Z");
  assert.equal(later.offAt, "2026-11-03T11:30:00.000Z");
  assert.equal(
    timerMessage({ mode: "later", minutes: 30, onAt: later.onAt, offAt: later.offAt }),
    "השקע יופעל בשעה \u206613:00\u2069 ויכבה בשעה \u206613:30\u2069",
  );

  const passed = timerInstants({ minutes: 30, start: "13:00" }, new Date("2026-11-03T12:00:00.000Z"));
  assert.equal(passed.onAt, "2026-11-04T11:00:00.000Z");
  assert.equal(passed.offAt, "2026-11-04T11:30:00.000Z");
});

test("an immediate timer only schedules the switch off", () => {
  const immediate = timerInstants({ minutes: 15, start: "now" }, now);
  assert.equal(immediate.onAt, null);
  assert.equal(immediate.offAt, "2026-11-03T08:15:00.000Z");
  assert.equal(timerMessage({ mode: "now", minutes: 1, onAt: null, offAt: immediate.offAt }), "השקע יופעל עכשיו ויכבה בעוד 1 דקה");
  assert.throws(() => timerInstants({ minutes: 0, start: "now" }, now), /12 שעות/);
  assert.throws(() => timerInstants({ minutes: 721, start: "now" }, now), /12 שעות/);
  assert.throws(() => timerInstants({ minutes: 30, start: "25:00" }, now), /השעה/);
});

test("icon names are suggested from the socket name until one is chosen", () => {
  assert.equal(suggestIcon("שקע מזגן"), "ac");
  assert.equal(suggestIcon("שקע תאורה"), "light");
  assert.equal(suggestIcon("מנורה"), "light");
  assert.equal(suggestIcon("מאוורר תקרה"), "fan");
  assert.equal(suggestIcon("דוד שמש"), "boiler");
  assert.equal(suggestIcon("מקרר"), "fridge");
  assert.equal(suggestIcon("תנור חימום"), "heat");
  assert.equal(suggestIcon("שקע אולם"), "socket");
  assert.equal(isDeviceIcon("ac"), true);
  assert.equal(isDeviceIcon("motor"), false);
});

test("the card clock says today, tomorrow, or the date", () => {
  assert.equal(planWhen("2026-11-03T11:00:00.000Z", now), "13:00");
  assert.equal(planWhen("2026-11-04T11:00:00.000Z", now), "מחר 13:00");
  assert.equal(planWhen("2026-11-05T11:00:00.000Z", now), "05.11 13:00");
});

test("a published socket keeps its next event and drops the phone", () => {
  const device: DeviceView & { phone: string } = {
    deviceId: "rct1",
    name: "שקע מזגן",
    tenantId: "ten",
    tenantName: "ישיבה",
    phone: "035551001",
    connectivity: "ONLINE",
    relayOn: false,
    stateUpdatedAt: now.toISOString(),
    deviceType: "SC1_T",
    sensorSummary: "טמפרטורה: לא מחובר",
    lastError: null,
    icon: "ac",
    next: { at: "2026-11-03T11:00:00.000Z", action: "ON" },
  };
  const view = presentDevice(device);
  assert.equal(view.icon, "ac");
  assert.deepEqual(view.next, { at: "2026-11-03T11:00:00.000Z", action: "ON" });
  assert.equal("phone" in view, false);
});
