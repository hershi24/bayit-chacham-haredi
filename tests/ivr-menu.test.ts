import assert from "node:assert/strict";
import test from "node:test";
import { devicesForPhone } from "../lib/access";
import { decideMenu, type MenuDevice } from "../lib/ivr/flow";
import { handleMenu } from "../lib/ivr/menu";
import { cleanYemotText, yemotRead } from "../lib/ivr/yemot";
import { handleIvr } from "../lib/ivr/handle";
import { createDevice, createTenant, deleteDevice, deleteTenant, getDevice, setDeviceFrozen, updateDeviceState } from "../lib/store";
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
  const spoken = yemotRead(list);
  assert.equal(spoken.startsWith("read=t-"), true);
  assert.equal(spoken.includes("=&"), false);
  assert.match(spoken, /,No,/);
  assert.equal(cleanYemotText("שקע-אולם. דולק"), "שקע אולם, דולק");

  const off = decideMenu([ac, light], { device: "1" });
  assert.equal(off.type, "read");
  if (off.type !== "read") return;
  assert.match(off.message, /כבוי כעת, להפעלה הקש אחד/);
  assert.equal(off.message.includes("לכיבוי"), false);
  assert.equal(off.allowed, "1345");
  assert.match(off.message, /לתוכניות הקש חמש/);

  const on = decideMenu([ac, light], { device: "2" });
  assert.equal(on.type, "read");
  if (on.type !== "read") return;
  assert.match(on.message, /פועל כעת, לכיבוי הקש אחד/);
  assert.equal(on.message.includes("להפעלה"), false);
  assert.equal(on.allowed, "1345");
});

test("timer turns on for the requested minutes and the clock accepts four digits", () => {
  const ask = decideMenu([ac], { device: "1", action: "3" });
  assert.equal(ask.type, "read");
  if (ask.type === "read") assert.equal(ask.field, "pikud_minutes");

  const timer = decideMenu([ac], { device: "1", action: "3", minutes: "15" });
  assert.deepEqual(timer, { type: "timer", device: ac, minutes: 15 });
  assert.equal(decideMenu([ac], { device: "1", action: "3", minutes: "0" }).type, "read");
  assert.equal(decideMenu([ac], { device: "1", action: "3", minutes: "999" }).type, "read");

  const repeat = decideMenu([ac], { device: "1", action: "4" });
  assert.equal(repeat.type, "read");
  if (repeat.type === "read") assert.equal(repeat.field, "pikud_repeat");

  const saved = decideMenu([ac], { device: "1", action: "4", repeat: "3", on: "1000", off: "1200" });
  assert.equal(saved.type, "clock-save");
  if (saved.type === "clock-save") {
    assert.deepEqual(saved.weekdays, [0, 1, 2, 3, 4]);
    assert.equal(saved.onTime, "10:00");
    assert.equal(saved.offTime, "12:00");
    assert.deepEqual(saved.devices.map((item) => item.deviceId), ["ac"]);
  }
  const custom = decideMenu([ac], { device: "1", action: "4", repeat: "4", week: "15", on: "2200", off: "0600" });
  assert.equal(custom.type, "clock-save");
  if (custom.type === "clock-save") {
    assert.deepEqual(custom.weekdays, [0, 4]);
    assert.equal(custom.onTime, "22:00");
    assert.equal(custom.offTime, "06:00");
  }
  const once = decideMenu([ac], { device: "1", action: "4", repeat: "1", date: "03112026", on: "9999", off: "1800" });
  assert.equal(once.type, "clock-save");
  if (once.type === "clock-save") {
    assert.equal(once.day, "2026-11-03");
    assert.equal(once.onTime, null);
    assert.equal(once.offTime, "18:00");
  }
  assert.equal(decideMenu([ac], { device: "1", action: "4", repeat: "1", date: "03112026", on: "1860" }).type, "read");
  const both = decideMenu([ac, light], { device: "1", action: "4", repeat: "2", on: "1000", off: "1200" });
  assert.equal(both.type, "read");
  if (both.type === "read") assert.equal(both.field, "pikud_sockets");

  const turnOn = decideMenu([ac], { device: "1", action: "1" });
  assert.equal(turnOn.type, "turn");
  if (turnOn.type === "turn") assert.equal(turnOn.action, "ON");
  const turnOff = decideMenu([light], { device: "1", action: "1" });
  assert.equal(turnOff.type, "turn");
  if (turnOff.type === "turn") assert.equal(turnOff.action, "OFF");
  const unknown = decideMenu([{ ...ac, relayOn: null }], { device: "1", action: "1" });
  assert.equal(unknown.type, "turn");
  if (unknown.type === "turn") assert.equal(unknown.action, "ON");
  const rejected = decideMenu([light], { device: "1", action: "2" });
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

  const menu = await phonePress({ ApiPhone: "035551001", pikud_device: "1" });
  assert.match(await menu.text(), /כבוי כעת, להפעלה הקש אחד/);

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
    const timer = await phonePress({ ApiPhone: "0540001777", pikud_device: "1", pikud_action: "3", pikud_minutes: "15" });
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
