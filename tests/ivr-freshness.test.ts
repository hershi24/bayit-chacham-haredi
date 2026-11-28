import assert from "node:assert/strict";
import test from "node:test";
import { devicesForPhone } from "../lib/access";
import { speechFor } from "../lib/ivr/speech";
import {
  addCallerNumber,
  createDevice,
  createTenant,
  deleteDevice,
  deleteProgram,
  deleteTenant,
  listIvrTargets,
  listPrograms,
  removeCallerNumber,
  updateDeviceState,
  upsertProgram,
} from "../lib/store";
import { programId } from "../lib/programs/sync";

test("an offline socket is announced from its link, not from the stamp", () => {
  assert.equal(speechFor({ kind: "offline", name: "דוד" }), "דוד אינו מחובר כעת");
  assert.equal(speechFor({ kind: "on-success", name: "דוד" }).includes("דוד"), true);
  assert.equal(speechFor({ kind: "off-success", name: "דוד" }).includes("דוד"), true);
});

test("the phone menu keeps the caller, drops a removed number, and sees a new relay at once", async () => {
  const tenant = await createTenant({ name: "שיחה", phone: null });
  const other = await createTenant({ name: "שכן", phone: null });
  const deviceId = `ivr${String(Date.now()).slice(-6)}`;
  const phone = `050${String(Date.now()).slice(-7)}`;
  const stranger = `052${String(Date.now()).slice(-7)}`;
  try {
    await createDevice({ deviceId, name: "דוד", tenantId: tenant.id });
    const added = await addCallerNumber(tenant.id, phone, null);
    const coldStart = performance.now();
    const first = await listIvrTargets("fresh-call");
    const coldMs = performance.now() - coldStart;
    const warmStart = performance.now();
    const second = await listIvrTargets("fresh-call");
    const warmMs = performance.now() - warmStart;
    assert.equal(first, second);
    assert.equal(devicesForPhone(first, phone).map((device) => device.deviceId).includes(deviceId), true);
    assert.ok(warmMs <= coldMs || warmMs < 5, `warm ${warmMs.toFixed(2)}ms cold ${coldMs.toFixed(2)}ms`);
    console.log(`ivr list cold ${coldMs.toFixed(2)}ms warm ${warmMs.toFixed(2)}ms`);

    await updateDeviceState(deviceId, {
      connectivity: "OFFLINE",
      relayOn: false,
      stateUpdatedAt: "2026-11-28T16:00:00.000Z",
    });
    const offline = await listIvrTargets("fresh-call");
    assert.notEqual(offline, first);
    assert.equal(devicesForPhone(offline, phone).find((device) => device.deviceId === deviceId)?.connectivity, "OFFLINE");

    assert.equal(devicesForPhone(offline, stranger).some((device) => device.deviceId === deviceId), false);
    await addCallerNumber(other.id, stranger, null);
    const neighbor = devicesForPhone(await listIvrTargets("fresh-call"), stranger);
    assert.equal(neighbor.some((device) => device.deviceId === deviceId), false);

    await removeCallerNumber(tenant.id, added.id);
    assert.equal(devicesForPhone(await listIvrTargets("fresh-call"), phone).some((device) => device.deviceId === deviceId), false);
  } finally {
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
    await deleteTenant(other.id).catch(() => undefined);
  }
});

test("deleting a program is visible on the next read", async () => {
  const id = programId("ten_yeshiva", "days:traffic-check");
  await upsertProgram({
    id,
    tenantId: "ten_yeshiva",
    programKey: "days:traffic-check",
    name: "בדיקת מחיקה",
    enabled: true,
    deviceIds: ["rct063285302"],
    startDate: null,
    endDate: null,
    days: [],
    weekdays: [0],
    onTime: "18:00",
    offTime: "20:00",
    slots: [],
  });
  assert.equal((await listPrograms("ten_yeshiva")).some((program) => program.id === id), true);
  await deleteProgram("ten_yeshiva", id);
  assert.equal((await listPrograms("ten_yeshiva")).some((program) => program.id === id), false);
});
