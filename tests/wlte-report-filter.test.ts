import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STATE_STAMP_REFRESH_MS } from "../lib/devices/state-write";
import { DUE_INTERVAL_MS } from "../lib/schedules/run";
import { createDevice, createTenant, deleteDevice, deleteTenant, getDevice } from "../lib/store";
import { getBridge } from "../lib/wlte/bridge";
import type { NormalizedEvent } from "../lib/wlte/parse";
import {
  WLTE_STAMP_RESET_MS,
  classifyWlteReport,
  forgetWlteReport,
  noteWlteReportStamp,
  rememberWlteReport,
  resetWlteReports,
  settleWlteReport,
  type StoredWlteState,
} from "../lib/wlte/report-filter";

const stamp = "2026-11-28T12:00:00.000Z";
const deviceId = "wlte-filter";

function state(at: string, relayOn: boolean | null): NormalizedEvent {
  return { type: "state", deviceId, relayOn, stateUpdatedAt: at };
}

function link(at: string, connectivity: "ONLINE" | "OFFLINE", topic: string): NormalizedEvent {
  return { type: "connectivity", deviceId, connectivity, stateUpdatedAt: at, topic };
}

function remember(relayOn: boolean | null, connectivity: string, at: string | null) {
  rememberWlteReport(deviceId, { relayOn, connectivity, stateUpdatedAt: at });
}

test("duplicate WLTE reports are dropped before a read, and a real change is not", () => {
  resetWlteReports();
  assert.equal(DUE_INTERVAL_MS, 15_000);
  const source = readFileSync(new URL("../lib/wlte/bridge.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("private async onPayload"));
  const classifyAt = body.indexOf("classifyWlteReport");
  const readAt = body.indexOf("readDevice");
  assert.ok(classifyAt >= 0 && readAt > classifyAt);
  assert.ok(body.indexOf('decision === "duplicate"') < readAt);
  assert.equal(body.includes("isNewerIso"), false);

  const stored: StoredWlteState = { relayOn: false, connectivity: "ONLINE", stateUpdatedAt: stamp };
  assert.equal(classifyWlteReport(state(stamp, false)), "cold");
  const first = settleWlteReport("cold", state(stamp, false), stored);
  assert.equal(first.patch, null);
  rememberWlteReport(deviceId, first.remember);
  assert.equal(classifyWlteReport(state(stamp, false)), "duplicate");

  assert.equal(classifyWlteReport(state(stamp, true)), "change");
  const flipped = settleWlteReport("change", state(stamp, true), stored);
  assert.equal(flipped.patch?.relayOn, true);
  assert.equal(flipped.patch?.stateUpdatedAt, stamp);
  rememberWlteReport(deviceId, flipped.remember);
  assert.equal(classifyWlteReport(state(stamp, true)), "duplicate");

  assert.equal(classifyWlteReport(link(stamp, "OFFLINE", "device.connection.offline")), "change");
  const dropped = settleWlteReport("change", link(stamp, "OFFLINE", "device.connection.offline"), {
    ...stored,
    relayOn: true,
  });
  assert.equal(dropped.patch?.connectivity, "OFFLINE");
  rememberWlteReport(deviceId, dropped.remember);
  assert.equal(classifyWlteReport(link(stamp, "ONLINE", "device.connection.online")), "change");
  assert.equal(classifyWlteReport(link(stamp, "ONLINE", "device.power.restored")), "change");

  remember(true, "ONLINE", stamp);
  assert.equal(classifyWlteReport(link(stamp, "ONLINE", "device.power.restored")), "change");
  const restored = settleWlteReport("change", link(stamp, "ONLINE", "device.power.restored"), {
    relayOn: true,
    connectivity: "ONLINE",
    stateUpdatedAt: stamp,
  });
  assert.equal(restored.patch, null);

  const slightlyOlder = new Date(Date.parse(stamp) - 5_000).toISOString();
  assert.equal(classifyWlteReport(state(slightlyOlder, false)), "duplicate");

  const resetAt = new Date(Date.parse(stamp) - WLTE_STAMP_RESET_MS).toISOString();
  assert.equal(classifyWlteReport(state(resetAt, true)), "reset");
  noteWlteReportStamp(deviceId, resetAt);
  assert.equal(classifyWlteReport(state(resetAt, true)), "duplicate");
  assert.equal(classifyWlteReport(state(resetAt, false)), "change");

  resetWlteReports();
  assert.equal(classifyWlteReport(state(stamp, false)), "cold");
  const stale = settleWlteReport("cold", state(slightlyOlder, false), {
    relayOn: true,
    connectivity: "ONLINE",
    stateUpdatedAt: stamp,
  });
  assert.equal(stale.patch, null);
  assert.equal(stale.remember.relayOn, true);
  rememberWlteReport(deviceId, stale.remember);
  assert.equal(classifyWlteReport(state(slightlyOlder, false)), "duplicate");

  const refreshed = new Date(Date.parse(stamp) + STATE_STAMP_REFRESH_MS).toISOString();
  remember(true, "ONLINE", stamp);
  assert.equal(classifyWlteReport(state(refreshed, true)), "refresh");
  const quiet = settleWlteReport("refresh", state(refreshed, true), {
    relayOn: true,
    connectivity: "ONLINE",
    stateUpdatedAt: stamp,
  });
  assert.equal(quiet.patch?.stateUpdatedAt, refreshed);
  assert.equal(quiet.patch?.relayOn, undefined);
  forgetWlteReport(deviceId);
});

test("a repeated status sample does not rewrite the socket, and a relay change still does", async () => {
  const tenant = await createTenant({ name: "סינון דיווחים", phone: null });
  const id = `rpt${String(Date.now()).slice(-6)}`;
  forgetWlteReport(id);
  try {
    await createDevice({ deviceId: id, name: "שקע", tenantId: tenant.id });
    await getBridge().registerDevice(id, "שקע");
    const opened = await getDevice(id, { plans: false });
    assert.equal(opened?.relayOn, false);
    assert.equal(opened?.connectivity, "ONLINE");
    await getBridge().simulate(id, { relayOn: false });
    const afterSame = await getDevice(id, { plans: false });
    assert.equal(afterSame?.stateUpdatedAt, opened?.stateUpdatedAt);
    await getBridge().simulate(id, { relayOn: false });
    assert.equal((await getDevice(id, { plans: false }))?.stateUpdatedAt, opened?.stateUpdatedAt);

    await getBridge().simulate(id, { relayOn: true });
    const on = await getDevice(id, { plans: false });
    assert.equal(on?.relayOn, true);
    assert.notEqual(on?.stateUpdatedAt, opened?.stateUpdatedAt);

    await getBridge().simulate(id, { online: false });
    const offline = await getDevice(id, { plans: false });
    assert.equal(offline?.connectivity, "OFFLINE");
    assert.equal(offline?.relayOn, true);
    assert.equal(offline?.lastOnlineAt, on?.stateUpdatedAt);
  } finally {
    forgetWlteReport(id);
    await deleteDevice(id).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});
