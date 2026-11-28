import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STATE_STAMP_REFRESH_MS, resetStateStamps, sameObservedState, shouldPersistObservedState } from "../lib/devices/state-write";
import { sameShellyBackup, type ShellyBackupRow } from "../lib/shelly/backup-record";
import { shouldPushBackup } from "../lib/shelly/backup-plan";
import { createCoalescingGuard, createRoundGuard } from "../lib/schedules/guard";
import { DUE_INTERVAL_MS, PROGRAM_SYNC_INTERVAL_MS, SHELLY_SYNC_INTERVAL_MS } from "../lib/schedules/run";
import { createKeyedCache } from "../lib/store-cache";
import {
  createDevice,
  createTenant,
  deleteDevice,
  deleteTenant,
  getDevice,
  getShellyBackup,
  getShellyBackupGate,
  listTenantDevices,
  listTenantIds,
  saveShellyBackup,
  setDeviceName,
  updateDeviceState,
} from "../lib/store";
import { backgroundScanReads, classifyRequest, recordTraffic, resetTraffic, trafficSnapshot } from "../lib/traffic";

test("clocks stay on a 15 second loop and the two syncs are separate", () => {
  assert.equal(DUE_INTERVAL_MS, 15_000);
  assert.equal(PROGRAM_SYNC_INTERVAL_MS, 60_000);
  assert.equal(SHELLY_SYNC_INTERVAL_MS, 60_000);
  const source = readFileSync(new URL("../lib/schedules/run.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function runDueSchedules");
  const body = source.slice(start);
  assert.equal(body.includes("syncProgramsIfStale"), false);
  assert.equal(body.includes("syncShellyBackups("), false);
  assert.match(source, /startLoop\(DUE_INTERVAL_MS/);
  assert.match(source, /startLoop\(PROGRAM_SYNC_INTERVAL_MS/);
  assert.match(source, /startLoop\(SHELLY_SYNC_INTERVAL_MS/);
});

test("a round does not start while the previous one is still running", async () => {
  const guard = createRoundGuard();
  let release: (() => void) | undefined;
  const first = guard(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  assert.equal(await guard(async () => undefined), "skipped");
  release?.();
  assert.equal(await first, "ran");
  assert.equal(await guard(async () => undefined), "ran");
});

test("a second sync waits and runs once after the current round", async () => {
  const guard = createCoalescingGuard();
  const ran: string[] = [];
  let release: (() => void) | undefined;
  const first = guard(
    () =>
      new Promise<void>((resolve) => {
        ran.push("first");
        release = resolve;
      }),
  );
  assert.equal(
    await guard(async () => {
      ran.push("second");
    }),
    "joined",
  );
  assert.equal(
    await guard(async () => {
      ran.push("third");
    }),
    "joined",
  );
  release?.();
  assert.equal(await first, "ran");
  assert.deepEqual(ran, ["first", "third"]);
});

test("a cached device list is dropped when the socket is renamed or moved", async () => {
  const tenant = await createTenant({ name: "מטמון שקעים", phone: null });
  const deviceId = `cache${String(Date.now()).slice(-6)}`;
  try {
    await createDevice({ deviceId, name: "לפני", tenantId: tenant.id });
    const first = await listTenantDevices(tenant.id);
    const second = await listTenantDevices(tenant.id);
    assert.equal(first, second);
    assert.equal(first.find((device) => device.deviceId === deviceId)?.name, "לפני");
    await setDeviceName(deviceId, "אחרי");
    const renamed = await listTenantDevices(tenant.id);
    assert.equal(renamed.find((device) => device.deviceId === deviceId)?.name, "אחרי");
    assert.notEqual(renamed, first);
  } finally {
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});

test("a new customer appears in the tenant id list at once", async () => {
  const before = await listTenantIds();
  const again = await listTenantIds();
  assert.equal(before, again);
  const tenant = await createTenant({ name: "לקוח חדש למטמון", phone: null });
  try {
    const after = await listTenantIds();
    assert.ok(after.includes(tenant.id));
    assert.equal(after.includes("missing-tenant"), false);
  } finally {
    await deleteTenant(tenant.id).catch(() => undefined);
  }
  const gone = await listTenantIds();
  assert.equal(gone.includes(tenant.id), false);
});

test("the backup gate reads the window without treating an unchanged idle row as new", async () => {
  const row: ShellyBackupRow = {
    shellyId: `gate${String(Date.now()).slice(-6)}`,
    tenantId: "ten_yeshiva",
    status: "idle",
    mode: null,
    windowStart: null,
    windowEnd: null,
    windowLabel: null,
    planHash: null,
    actionCount: 0,
    planCode: null,
    scheduleIds: [],
    syncedAt: null,
    verifiedAt: null,
    error: null,
    attempts: 0,
    alertedAt: null,
    watch: true,
    checkedAt: null,
    nextCheckAt: "2026-12-01T00:00:00.000Z",
    updatedAt: "2026-11-28T10:00:00.000Z",
  };
  try {
    await saveShellyBackup(row);
    const gate = await getShellyBackupGate(row.shellyId);
    assert.equal(gate?.watch, true);
    assert.equal(gate?.nextCheckAt, row.nextCheckAt);
    assert.equal(gate?.status, "idle");
    const stored = await getShellyBackup(row.shellyId);
    assert.equal(stored?.planCode, null);
    assert.equal(sameShellyBackup(row, { ...row, updatedAt: "2026-11-28T10:01:00.000Z" }), true);
    assert.equal(sameShellyBackup(row, { ...row, status: "verified" }), false);
  } finally {
    // Leaving the row is harmless; the id is unique. A later delete of the tenant is not ours.
  }
});

test("an identical sample does not move the stored stamp, and a real change does", async () => {
  resetStateStamps();
  const deviceId = `state${String(Date.now()).slice(-6)}`;
  const tenant = await createTenant({ name: "מצב זהה", phone: null });
  try {
    await createDevice({ deviceId, name: "שקע", tenantId: tenant.id });
    const first = "2026-11-28T10:00:00.000Z";
    const second = "2026-11-28T10:00:05.000Z";
    const off = "2026-11-28T10:00:04.000Z";
    await updateDeviceState(deviceId, { connectivity: "ONLINE", relayOn: true, stateUpdatedAt: first, lastError: null });
    await updateDeviceState(deviceId, { connectivity: "ONLINE", relayOn: true, stateUpdatedAt: second, lastError: null });
    assert.equal((await getDevice(deviceId))?.stateUpdatedAt, first);
    await updateDeviceState(deviceId, { connectivity: "ONLINE", relayOn: false, stateUpdatedAt: off }, { onlyIfNewer: true });
    assert.equal((await getDevice(deviceId))?.relayOn, true);
    await updateDeviceState(deviceId, { connectivity: "OFFLINE", relayOn: true, stateUpdatedAt: "2026-11-28T10:00:06.000Z" });
    const offline = await getDevice(deviceId);
    assert.equal(offline?.connectivity, "OFFLINE");
    assert.equal(offline?.lastOnlineAt, first);
    const later = new Date(Date.parse(first) + STATE_STAMP_REFRESH_MS).toISOString();
    await updateDeviceState(deviceId, { connectivity: "ONLINE", relayOn: true, stateUpdatedAt: later, lastError: null });
    assert.equal((await getDevice(deviceId))?.stateUpdatedAt, later);
    assert.equal((await getDevice(deviceId))?.connectivity, "ONLINE");
  } finally {
    resetStateStamps();
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});

test("disconnect and reconnect are different observations", () => {
  const online = { connectivity: "ONLINE", relayOn: true, deviceType: "SC1_T", sensorSummary: null, lastError: null };
  assert.equal(sameObservedState(online, online), true);
  assert.equal(sameObservedState(online, { ...online, connectivity: "OFFLINE" }), false);
  assert.equal(sameObservedState({ ...online, connectivity: "OFFLINE" }, online), false);
  assert.equal(
    shouldPersistObservedState(online, online, "2026-11-28T10:00:00.000Z", "2026-11-28T10:00:05.000Z"),
    false,
  );
});

test("the background scan drops the phone list and the 15 second repetition", () => {
  const before = backgroundScanReads({ tenants: 10, shellies: 10, before: true });
  const after = backgroundScanReads({ tenants: 10, shellies: 10, before: false });
  assert.equal(before.callerNumbers, 480);
  assert.equal(after.callerNumbers, 0);
  assert.equal(before.total, 5760);
  assert.equal(after.total, 1320);
  assert.ok(after.total < before.total / 4);
});

test("traffic counters add up in memory", () => {
  resetTraffic();
  recordTraffic("supabase", { bytesSent: 20, bytesReceived: 80 });
  recordTraffic("wlte", { bytesSent: 5, bytesReceived: 15 });
  recordTraffic("supabase", { bytesSent: 1, bytesReceived: 2 });
  const snap = trafficSnapshot();
  assert.equal(snap.supabase.measured.requests, 2);
  assert.equal(snap.supabase.measured.bytesSent, 21);
  assert.equal(snap.supabase.measured.bytesReceived, 82);
  assert.equal(snap.wlte.measured.requests, 1);
  assert.equal(snap.wlte.measured.bytesReceived, 15);
  assert.equal(snap.supabase.hourlyIsForecast, true);
  assert.equal(snap.supabase.monthlyIsForecast, true);
  resetTraffic();
  assert.equal(trafficSnapshot().supabase.measured.requests, 0);
});

test("a request is filed by table and operation", () => {
  resetTraffic();
  recordTraffic("supabase", {
    bytesSent: 10,
    bytesReceived: 40,
    ...classifyRequest("supabase", "https://example.supabase.co/rest/v1/devices?select=id", "GET"),
  });
  recordTraffic("wlte", {
    bytesSent: 8,
    bytesReceived: 12,
    ...classifyRequest("wlte", "https://wlte.example/wlte/v1/devices/abc/relays/commands", "POST"),
  });
  const snap = trafficSnapshot();
  assert.equal(snap.slices.find((slice) => slice.peer === "supabase")?.name, "devices");
  assert.equal(snap.slices.find((slice) => slice.peer === "supabase")?.operation, "read");
  assert.equal(snap.slices.find((slice) => slice.peer === "wlte")?.name, "command");
  resetTraffic();
});

test("a keyed cache expires and forgets one key", () => {
  let now = 1_000;
  const cache = createKeyedCache<string>(60_000, () => now);
  cache.set("a", "א");
  cache.set("b", "ב");
  assert.equal(cache.get("a"), "א");
  cache.delete("a");
  assert.equal(cache.get("a"), undefined);
  now += 60_000;
  assert.equal(cache.get("b"), undefined);
});

test("a Shabbat window that starts within minutes is still pushed, and a changed plan is not an idle row", () => {
  const now = new Date("2026-11-27T14:00:00.000Z");
  const soon = {
    start: new Date(now.getTime() + 20 * 60_000).toISOString(),
    end: new Date(now.getTime() + 25 * 60 * 60_000).toISOString(),
    label: "שבת",
  };
  assert.equal(shouldPushBackup(soon, now), true);
  const row = {
    shellyId: "s",
    tenantId: "t",
    status: "verified" as const,
    mode: "script" as const,
    windowStart: soon.start,
    windowEnd: soon.end,
    windowLabel: "שבת",
    planHash: "old",
    actionCount: 1,
    planCode: "a",
    scheduleIds: [],
    syncedAt: now.toISOString(),
    verifiedAt: now.toISOString(),
    error: null,
    attempts: 0,
    alertedAt: null,
    watch: false,
    checkedAt: null,
    nextCheckAt: null,
    updatedAt: now.toISOString(),
  };
  assert.equal(sameShellyBackup(row, { ...row, planHash: "new" }), false);
});
