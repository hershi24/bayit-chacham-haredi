import assert from "node:assert/strict";
import test from "node:test";
import { decideMenu } from "../lib/ivr/flow";
import { cleanShellyId, parseShellyChannelId, shellyChannelDeviceId, shellyIdsMatch, shellyMac } from "../lib/shelly/ids";
import { channelStatesFromStatus, parseShellyFrame, readDeviceInfoId, switchSetCall } from "../lib/shelly/rpc";
import { getShellyHub } from "../lib/shelly/hub";
import {
  createShellyPro3,
  createTenant,
  deleteDevice,
  deleteTenant,
  findShellyDevices,
  getDevice,
  listDevicesByExternalId,
  updateDeviceState,
} from "../lib/store";

test("shelly channel ids round-trip", () => {
  const id = cleanShellyId("ShellyPro3G3-AABBCC");
  assert.equal(id, "shellypro3g3-aabbcc");
  assert.equal(shellyChannelDeviceId(id, 0), "shellypro3g3-aabbcc_ch0");
  assert.deepEqual(parseShellyChannelId("shellypro3g3-aabbcc_ch2"), { shellyId: "shellypro3g3-aabbcc", channel: 2 });
  assert.equal(parseShellyChannelId("rct063285302"), null);
});

test("Shelly app device id matches full device info id by MAC", () => {
  assert.equal(cleanShellyId("8c4f008f0328"), "8c4f008f0328");
  assert.equal(shellyMac("shellypro3-8c4f008f0328"), "8c4f008f0328");
  assert.equal(shellyIdsMatch("8c4f008f0328", "shellypro3-8c4f008f0328"), true);
  assert.equal(shellyIdsMatch("8c4f008f0328", "shellypro3g3-deadbeef0001"), false);
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

test("Shelly refreshPresence updates connectivity from the live hub", async () => {
  const tenant = await createTenant({ name: `Shelly refresh ${Date.now()}`, phone: null });
  const shellyId = `shellypro3g3-rf${String(Date.now()).slice(-6)}`;
  try {
    await createShellyPro3({
      shellyId,
      tenantId: tenant.id,
      kind: "panel",
      channels: ["רענון א", "רענון ב", "רענון ג"],
    });
    await updateDeviceState(`${shellyId}_ch0`, { connectivity: "OFFLINE", relayOn: false });
    getShellyHub().mockConnect(shellyId, [
      { channel: 0, on: true },
      { channel: 1, on: false },
      { channel: 2, on: false },
    ]);
    const online = await getShellyHub().refreshPresence(shellyId);
    assert.equal(online, true);
    assert.equal((await getDevice(`${shellyId}_ch0`))?.connectivity, "ONLINE");
    assert.equal((await getDevice(`${shellyId}_ch0`))?.relayOn, true);

    getShellyHub().mockDisconnect(shellyId);
    const offline = await getShellyHub().refreshPresence(shellyId);
    assert.equal(offline, false);
    assert.equal((await getDevice(`${shellyId}_ch0`))?.connectivity, "OFFLINE");
  } finally {
    getShellyHub().mockDisconnect(shellyId);
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

test("a missed Shelly heartbeat marks channels offline without waiting for TCP timeout", async () => {
  const tenant = await createTenant({ name: `Shelly HB ${Date.now()}`, phone: null });
  const shellyId = `shellypro3g3-hb${String(Date.now()).slice(-6)}`;
  try {
    await createShellyPro3({
      shellyId,
      tenantId: tenant.id,
      kind: "panel",
      channels: ["ערוץ א", "ערוץ ב", "ערוץ ג"],
    });
    const at = new Date().toISOString();
    for (const channel of [0, 1, 2]) {
      await updateDeviceState(`${shellyId}_ch${channel}`, { connectivity: "ONLINE", stateUpdatedAt: at });
    }
    assert.equal((await getDevice(`${shellyId}_ch0`))?.connectivity, "ONLINE");

    let terminated = false;
    const fake = {
      OPEN: 1,
      readyState: 1,
      ping() {},
      terminate() {
        terminated = true;
        this.readyState = 3;
      },
    };

    // Same path as power-cut: socket still "open", but no pong → drop and mark OFFLINE.
    getShellyHub().testHeartbeat(shellyId, fake as never, false);
    assert.equal(terminated, true);
    assert.equal(getShellyHub().isOnline(shellyId), false);
    // markOffline is async; wait a tick for store + SSE publish.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await getDevice(`${shellyId}_ch0`))?.connectivity, "OFFLINE");
    assert.equal((await getDevice(`${shellyId}_ch1`))?.connectivity, "OFFLINE");
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

test("admin can paste the short MAC from the Shelly app and still resolve the unit", async () => {
  const tenant = await createTenant({ name: `Shelly MAC ${Date.now()}`, phone: null });
  const mac = `8c4f00${String(Date.now()).slice(-6)}`;
  try {
    await createShellyPro3({
      shellyId: mac,
      tenantId: tenant.id,
      kind: "panel",
      channels: ["לוח א", "לוח ב", "לוח ג"],
    });
    const found = await findShellyDevices(`shellypro3-${mac}`);
    assert.equal(found.length, 3);
    assert.equal(found[0]?.externalId, mac);
  } finally {
    for (const channel of [0, 1, 2]) {
      try {
        await deleteDevice(`${mac}_ch${channel}`);
      } catch {
        // ignore
      }
    }
    await deleteTenant(tenant.id);
  }
});
