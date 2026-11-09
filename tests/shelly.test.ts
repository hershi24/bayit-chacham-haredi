import assert from "node:assert/strict";
import test from "node:test";
import { decideMenu } from "../lib/ivr/flow";
import { cleanShellyId, parseShellyChannelId, shellyChannelDeviceId } from "../lib/shelly/ids";
import { channelStatesFromStatus, parseShellyFrame, readDeviceInfoId, switchSetCall } from "../lib/shelly/rpc";
import { getShellyHub } from "../lib/shelly/hub";
import { createShellyPro3, createTenant, deleteDevice, deleteTenant, getDevice, listDevicesByExternalId } from "../lib/store";

test("shelly channel ids round-trip", () => {
  const id = cleanShellyId("ShellyPro3G3-AABBCC");
  assert.equal(id, "shellypro3g3-aabbcc");
  assert.equal(shellyChannelDeviceId(id, 0), "shellypro3g3-aabbcc_ch0");
  assert.deepEqual(parseShellyChannelId("shellypro3g3-aabbcc_ch2"), { shellyId: "shellypro3g3-aabbcc", channel: 2 });
  assert.equal(parseShellyChannelId("rct063285302"), null);
});

test("rpc helpers parse status and device info", () => {
  const frame = parseShellyFrame(
    JSON.stringify({
      result: { id: "shellypro3g3-demo", model: "SP3" },
    }),
  );
  assert.equal(readDeviceInfoId(frame?.result), "shellypro3g3-demo");
  const states = channelStatesFromStatus({
    "switch:0": { output: true },
    "switch:1": { output: false },
    "switch:2": { on: true },
  });
  assert.deepEqual(states, [
    { channel: 0, on: true },
    { channel: 1, on: false },
    { channel: 2, on: true },
  ]);
  assert.match(switchSetCall(9, 1, true), /"Switch.Set"/);
});

test("IVR lists each Shelly channel by the name chosen in admin", () => {
  const menu = decideMenu(
    [
      { deviceId: "shelly_ch0", name: "לוח תאורה", relayOn: false, connectivity: "ONLINE" },
      { deviceId: "shelly_ch1", name: "לוח מזגן", relayOn: true, connectivity: "ONLINE" },
      { deviceId: "wlte1", name: "שקע מטבח", relayOn: false, connectivity: "ONLINE" },
    ],
    {},
  );
  assert.equal(menu.type, "read");
  if (menu.type !== "read") return;
  assert.match(menu.message, /ללוח תאורה הקש אחד/);
  assert.match(menu.message, /ללוח מזגן הקש שתיים/);
  assert.match(menu.message, /לשקע מטבח הקש שלוש/);
});

test("creating a Shelly Pro 3 registers three separate channels for a tenant", async () => {
  const tenant = await createTenant({ name: `Shelly ${Date.now()}`, phone: null });
  const shellyId = `shellypro3g3-test${String(Date.now()).slice(-6)}`;
  try {
    const created = await createShellyPro3({
      shellyId,
      tenantId: tenant.id,
      kind: "panel",
      channels: ["לוח תאורה", "לוח מזגן", "לוח דוד"],
    });
    assert.equal(created.length, 3);
    const listed = await listDevicesByExternalId(shellyId);
    assert.equal(listed.length, 3);
    assert.equal(listed[0]?.vendor, "shelly");
    assert.equal(listed[0]?.kind, "panel");
    assert.equal(listed[0]?.name, "לוח תאורה");
    assert.equal(listed[1]?.channel, 1);
    assert.equal(listed[2]?.deviceId, `${shellyId}_ch2`);

    getShellyHub().mockConnect(shellyId, [
      { channel: 0, on: false },
      { channel: 1, on: false },
      { channel: 2, on: false },
    ]);
    const result = await getShellyHub().command(`${shellyId}_ch1`, "ON");
    assert.equal(result.status, "SUCCESS");
    const mid = await getDevice(`${shellyId}_ch1`);
    assert.equal(mid?.relayOn, true);
    assert.equal(mid?.connectivity, "ONLINE");

    const removed = await deleteDevice(`${shellyId}_ch0`);
    assert.equal(removed.length, 3);
    assert.equal(await getDevice(`${shellyId}_ch1`), null);
    assert.equal((await listDevicesByExternalId(shellyId)).length, 0);
  } finally {
    for (const channel of [0, 1, 2]) {
      try {
        await deleteDevice(`${shellyId}_ch${channel}`);
      } catch {
        // ignore
      }
    }
    await deleteTenant(tenant.id);
  }
});
