import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CLOCK, upcomingAgenda } from "../lib/hebrew/calendar";
import { programId } from "../lib/programs/sync";
import { mergeBackupBlock } from "../lib/shelly/backup-plan";
import {
  createDevice,
  createTenant,
  deleteDevice,
  deleteProgram,
  deleteTenant,
  finishProgramRun,
  getDevice,
  listAudit,
  listRunsFor,
  replaceProgramRuns,
  setDeviceFrozen,
  upsertProgram,
} from "../lib/store";
import { getBridge } from "../lib/wlte/bridge";
import { desiredProgramAction, reconcileWlteDevice, reconcileWlteReturn, wlteCameBack } from "../lib/wlte/reconcile";

const during = new Date("2026-11-20T15:00:00.000Z");

test("the desired state is the latest program action that should already have run", () => {
  const on = { action: "ON" as const, runAt: "2026-11-20T14:05:00.000Z" };
  const off = { action: "OFF" as const, runAt: "2026-11-20T16:00:00.000Z" };
  assert.equal(desiredProgramAction([on, off], during), "ON");
  assert.equal(desiredProgramAction([on, off], new Date("2026-11-20T17:00:00.000Z")), "OFF");
  assert.equal(desiredProgramAction([off, on], new Date("2026-11-20T14:00:00.000Z")), null);
  assert.equal(
    desiredProgramAction(
      [
        { action: "ON", runAt: "2026-11-20T14:05:00.000Z" },
        { action: "OFF", runAt: "2026-11-20T14:05:00.000Z" },
      ],
      during,
    ),
    "OFF",
  );
});

test("only a WLTE socket that came back online is checked", () => {
  assert.equal(wlteCameBack({ connectivity: "OFFLINE", vendor: "wlte" }, { type: "connectivity", connectivity: "ONLINE", topic: "device.connection.online" }), true);
  assert.equal(wlteCameBack({ connectivity: "ONLINE", vendor: "wlte" }, { type: "connectivity", connectivity: "ONLINE", topic: "device.power.restored" }), true);
  assert.equal(wlteCameBack({ connectivity: "ONLINE", vendor: "wlte" }, { type: "connectivity", connectivity: "ONLINE", topic: "device.connection.online" }), false);
  assert.equal(wlteCameBack({ connectivity: "OFFLINE", vendor: "shelly" }, { type: "connectivity", connectivity: "ONLINE", topic: "device.connection.online" }), false);
  assert.equal(wlteCameBack({ connectivity: "OFFLINE", vendor: "wlte" }, { type: "state" }), false);
});

test("a WLTE socket that returns during Shabbat is corrected to the program, including a run the scheduler already closed", async () => {
  const tenant = await createTenant({ name: "בדיקת חזרה WLTE", phone: null });
  const deviceId = `wlteback${tenant.id.slice(-6)}`;
  const shellyId = `shellyback${tenant.id.slice(-6)}`;
  const id = programId(tenant.id, "shabbat-check");
  try {
    await createDevice({ deviceId, name: "אולם", tenantId: tenant.id });
    await createDevice({ deviceId: shellyId, name: "לוח", tenantId: tenant.id, vendor: "shelly" });
    await getBridge().registerDevice(deviceId, "אולם");
    const agenda = await upcomingAgenda(DEFAULT_CLOCK, during, 7);
    const block = mergeBackupBlock(
      agenda.map((window) => ({ title: window.programName, start: window.start, end: window.end })),
      during,
    );
    assert.ok(block);
    assert.ok(Date.parse(block.start) < during.getTime() && during.getTime() < Date.parse(block.end));
    await upsertProgram({
      id,
      tenantId: tenant.id,
      programKey: "shabbat-check",
      name: "שבת",
      enabled: true,
      deviceIds: [deviceId],
      startDate: null,
      endDate: null,
      days: [],
      weekdays: [],
      onTime: null,
      offTime: null,
      slots: [],
    });
    await replaceProgramRuns(id, [{ deviceId, action: "ON", runAt: block.start, label: "הדלקה" }]);
    const opened = await listRunsFor(id);
    assert.equal(opened.length, 1);
    await finishProgramRun(opened[0]!.id);

    assert.equal(await reconcileWlteReturn(deviceId, during), "ON");
    assert.equal((await getDevice(deviceId))?.relayOn, true);
    assert.equal(await reconcileWlteReturn(deviceId, during), null);

    await replaceProgramRuns(id, [{ deviceId, action: "OFF", runAt: new Date(during.getTime() - 60_000).toISOString(), label: "כיבוי" }]);
    assert.equal(await reconcileWlteReturn(deviceId, during), "OFF");
    assert.equal((await getDevice(deviceId))?.relayOn, false);
    assert.equal(await reconcileWlteReturn(deviceId, new Date("2026-11-18T08:00:00.000Z")), null);

    await setDeviceFrozen(deviceId, true);
    await getBridge().simulate(deviceId, { relayOn: true });
    assert.equal(await reconcileWlteReturn(deviceId, during), null);
    const shelly = await getDevice(shellyId);
    assert.ok(shelly);
    assert.equal(await reconcileWlteDevice(shelly, during), null);

    const checks = (await listAudit({ role: "admin", tenantId: null }, 40, tenant.id)).filter((entry) => entry.actor === "בדיקת שבת");
    assert.deepEqual(
      checks.map((entry) => entry.action),
      ["OFF", "ON"],
    );
  } finally {
    await deleteProgram(tenant.id, id).catch(() => undefined);
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteDevice(shellyId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});
