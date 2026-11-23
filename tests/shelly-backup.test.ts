import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { upcomingAgenda } from "../lib/hebrew/calendar";
import { DEFAULT_CLOCK } from "../lib/hebrew/calendar";
import {
  actionsForUnit,
  assessClock,
  chooseBackupMode,
  mergeBackupBlock,
  planHash,
  relayFixes,
  shellyTimespec,
  SHELLY_SCHEDULE_LIMIT,
  type BackupAction,
} from "../lib/shelly/backup-plan";
import { expiryScript, planFromScript, planScript } from "../lib/shelly/backup-script";
import { SHELLY_WATCH_EVERY_MS, SHELLY_WATCH_RETRY_MS, shellyBackupCoversRun, syncShellyUnit, type ShellyRpc } from "../lib/shelly/backup-sync";
import {
  createShellyPro3,
  createTenant,
  deleteDevice,
  deleteProgram,
  deleteTenant,
  listAudit,
  replaceProgramRuns,
  upsertProgram,
} from "../lib/store";

const now = new Date("2026-11-18T08:00:00.000Z");

test("a holiday attached to Shabbat in either direction is one local plan", () => {
  const shabbatThenHoliday = mergeBackupBlock(
    [
      { title: "שבת", start: "2026-11-06T14:00:00.000Z", end: "2026-11-07T15:40:00.000Z" },
      { title: "חג", start: "2026-11-07T16:10:00.000Z", end: "2026-11-08T15:40:00.000Z" },
    ],
    new Date("2026-11-01T00:00:00.000Z"),
  );
  assert.equal(shabbatThenHoliday?.end, "2026-11-08T15:40:00.000Z");
  assert.match(shabbatThenHoliday?.label ?? "", /שבת/);
  assert.match(shabbatThenHoliday?.label ?? "", /חג/);

  const holidayThenShabbat = mergeBackupBlock(
    [
      { title: "חג", start: "2026-11-05T14:00:00.000Z", end: "2026-11-07T15:40:00.000Z" },
      { title: "שבת", start: "2026-11-06T14:00:00.000Z", end: "2026-11-07T15:40:00.000Z" },
    ],
    new Date("2026-11-01T00:00:00.000Z"),
  );
  assert.equal(holidayThenShabbat?.end, "2026-11-07T15:40:00.000Z");

  const separate = mergeBackupBlock(
    [
      { title: "חג", start: "2026-11-05T14:00:00.000Z", end: "2026-11-05T16:00:00.000Z" },
      { title: "שבת", start: "2026-11-07T14:00:00.000Z", end: "2026-11-08T16:00:00.000Z" },
    ],
    new Date("2026-11-01T00:00:00.000Z"),
  );
  assert.equal(separate?.end, "2026-11-05T16:00:00.000Z");
  assert.equal(separate?.label, "חג");
});

test("a Shelly timespec is a calendar date without a leading zero, not a weekly loop", () => {
  assert.equal(shellyTimespec(Math.floor(Date.parse("2026-11-20T14:05:00.000Z") / 1000)), "0 5 16 20 11 *");
});

test("native schedules are used only while they fit beside the customer's own schedules", () => {
  assert.equal(chooseBackupMode({ jobCount: 2, foreignSchedules: 1, windowStarted: false }), "schedule");
  assert.equal(chooseBackupMode({ jobCount: SHELLY_SCHEDULE_LIMIT, foreignSchedules: 1, windowStarted: false }), "script");
  assert.equal(chooseBackupMode({ jobCount: 2, foreignSchedules: 0, windowStarted: true }), "script");
});

test("the device script runs the plan with the server and the network gone, including after power returns, and does not repeat next year", () => {
  const start = Math.floor(Date.parse("2026-11-20T14:00:00.000Z") / 1000);
  const actions: BackupAction[] = [
    { at: start + 60, channel: 0, on: true },
    { at: start + 3600, channel: 1, on: true },
    { at: start + 7200, channel: 0, on: false },
  ];
  const code = planScript(actions, start + 86_400);
  assert.deepEqual(planFromScript(code)?.actions, actions);
  const methods = new Set<string>();
  const first = play(code, start + 120, methods);
  assert.deepEqual(
    first.switches.map((item) => [item.id, item.on]),
    [[0, true]],
  );
  first.advance(start + 3630);
  assert.deepEqual(
    first.switches.map((item) => [item.id, item.on]),
    [
      [0, true],
      [1, true],
    ],
  );
  const restored = play(code, start + 3800, new Set(), first.kvs);
  assert.deepEqual(
    restored.switches.map((item) => [item.id, item.on] as const).sort((left, right) => left[0] - right[0]),
    [
      [0, true],
      [1, true],
    ],
  );
  const deadClock = play(code, 1_000_000, new Set());
  assert.equal(deadClock.switches.length, 0);
  const nextYear = play(code, start + 400 * 86_400, new Set());
  assert.equal(nextYear.switches.length, 0);
  assert.deepEqual([...methods].sort(), ["KVS.Get", "KVS.Set", "Switch.Set"]);

  const expiry = play(expiryScript([], start + 86_400, [4, 9]), start + 86_400 + 400, new Set());
  assert.deepEqual(expiry.deleted, [4, 9]);
  assert.equal(expiry.switches.length, 0);
});

test("after a power cut the device waits for a real clock, then applies the state that should already be on", () => {
  const start = Math.floor(Date.parse("2026-11-20T14:05:00.000Z") / 1000);
  const actions: BackupAction[] = [
    { at: start, channel: 0, on: true },
    { at: start + 2 * 3600, channel: 1, on: true },
    { at: start + 30 * 3600, channel: 0, on: false },
    { at: start + 40 * 3600, channel: 2, on: true },
  ];
  const end = start + 50 * 3600;
  const restoredAt = start + 20 * 3600;
  const code = planScript(actions, end);
  const methods = new Set<string>();
  const boot = play(code, 1_000_000, methods);
  assert.equal(boot.switches.length, 0);
  boot.advance(restoredAt);
  assert.deepEqual(
    boot.switches.map((item) => [item.id, item.on] as const).sort((left, right) => left[0] - right[0]),
    [
      [0, true],
      [1, true],
    ],
  );
  boot.advance(start + 40 * 3600 + 30);
  assert.equal(boot.switches.some((item) => item.id === 2), true);

  const scheduled = play(expiryScript(actions, end, [4, 9]), 1_000_000, new Set());
  assert.equal(scheduled.switches.length, 0);
  scheduled.advance(restoredAt);
  assert.deepEqual(
    scheduled.switches.map((item) => [item.id, item.on] as const).sort((left, right) => left[0] - right[0]),
    [
      [0, true],
      [1, true],
    ],
  );
  scheduled.advance(start + 40 * 3600 + 30);
  assert.equal(scheduled.switches.filter((item) => item.id === 2).length, 0);
  assert.equal(scheduled.deleted.length, 0);
  const missedSchedule = play(expiryScript(actions, end, [4, 9]), start + 40 * 3600 + 30, new Set());
  assert.ok(missedSchedule.switches.some((item) => item.id === 2 && item.on));
  assert.ok(missedSchedule.switches.some((item) => item.id === 0 && !item.on));
});

test("missed edges stay in the plan, and the server corrects a relay that came back in the wrong state", () => {
  const at = Date.parse("2026-11-20T15:00:00.000Z");
  const actions: BackupAction[] = [
    { at: Math.floor(at / 1000) - 3600, channel: 0, on: true },
    { at: Math.floor(at / 1000) + 3600, channel: 0, on: false },
  ];
  const kept = actionsForUnit(
    [
      { deviceId: "shelly_ch0", action: "ON", runAt: new Date(at - 3600_000).toISOString() },
      { deviceId: "shelly_ch0", action: "OFF", runAt: new Date(at + 3600_000).toISOString() },
    ],
    "shelly",
    new Map([["shelly_ch0", { channel: 0, frozen: false }]]),
    { start: new Date(at - 7200_000).toISOString(), end: new Date(at + 86_400_000).toISOString(), label: "שבת" },
    new Date(at),
  );
  assert.equal(kept.length, 2);
  assert.deepEqual(relayFixes([{ channel: 0, on: false }], actions, Math.floor(at / 1000), Math.floor(at / 1000) + 86_400), [{ channel: 0, on: true }]);
  assert.deepEqual(relayFixes([{ channel: 0, on: true }], actions, Math.floor(at / 1000), Math.floor(at / 1000) + 86_400), []);
  assert.deepEqual(relayFixes([{ channel: 0, on: false }], actions, Math.floor(at / 1000) + 90_000, Math.floor(at / 1000) + 86_400), []);
});

test("an admin sync writes only this Shelly's Shabbat plan, checks it, and leaves other schedules in place", async () => {
  const tenant = await createTenant({ name: "גיבוי שלי", phone: null });
  const shellyId = `shellybackup${String(Date.now()).slice(-6)}`;
  const deviceId = `${shellyId}_ch0`;
  const programId = `prog_${tenant.id}_backup`;
  const device = deviceOf(shellyId);
  try {
    await createShellyPro3({ shellyId, tenantId: tenant.id, kind: "panel", channels: ["אולם", "מזגן", "דוד"] });
    const block = await nextBlock();
    assert.ok(block);
    const onAt = new Date(Date.parse(block.start) + 30 * 60_000).toISOString();
    const offAt = new Date(Date.parse(block.start) + 90 * 60_000).toISOString();
    await upsertProgram({
      id: programId,
      tenantId: tenant.id,
      programKey: "days:backup",
      name: "גיבוי",
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
    await replaceProgramRuns(programId, [
      { deviceId, action: "ON", runAt: onAt, label: "הדלקה" },
      { deviceId, action: "OFF", runAt: offAt, label: "כיבוי" },
      { deviceId: "rct-not-shelly", action: "ON", runAt: onAt, label: "לא שלי" },
    ]);
    device.tz = "UTC";
    const saved = await syncShellyUnit(unit(tenant.id, shellyId, deviceId), device.rpc, now);
    assert.equal(saved.status, "verified");
    assert.equal(saved.mode, "schedule");
    assert.equal(saved.actionCount, 2);
    assert.match(saved.planCode ?? "", /Schedule\.Create/);
    assert.match(saved.planCode ?? "", /var PLAN/);
    assert.equal(device.tz, "Asia/Jerusalem");
    assert.equal(device.jobs.has(7), true);
    assert.equal([...device.jobs.keys()].filter((id) => id !== 7).length, 2);
    const again = await syncShellyUnit(unit(tenant.id, shellyId, deviceId), device.rpc, now);
    assert.equal(again.planHash, saved.planHash);
    assert.equal([...device.jobs.keys()].filter((id) => id !== 7).length, 2);

    device.corrupt = true;
    await replaceProgramRuns(programId, [
      { deviceId, action: "ON", runAt: new Date(Date.parse(onAt) + 5 * 60_000).toISOString(), label: "הדלקה" },
      { deviceId, action: "OFF", runAt: offAt, label: "כיבוי" },
    ]);
    const failed = await syncShellyUnit(unit(tenant.id, shellyId, deviceId), device.rpc, now);
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /לא תואמים/);
    device.corrupt = false;
    const fixed = await syncShellyUnit(unit(tenant.id, shellyId, deviceId), device.rpc, now);
    assert.equal(fixed.status, "verified");
    assert.equal(device.jobs.has(7), true);
    assert.notEqual(fixed.planHash, saved.planHash);
    assert.equal(await shellyBackupCoversRun(deviceId, onAt), true);
    assert.equal(await shellyBackupCoversRun("rct-not-shelly", onAt), false);
  } finally {
    await deleteProgram(tenant.id, programId).catch(() => undefined);
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});

test("when the schedule list is full the whole plan is stored in the device script instead", async () => {
  const tenant = await createTenant({ name: "גיבוי סקריפט", phone: null });
  const shellyId = `shellyscript${String(Date.now()).slice(-6)}`;
  const deviceId = `${shellyId}_ch0`;
  const programId = `prog_${tenant.id}_script`;
  const device = deviceOf(shellyId);
  try {
    await createShellyPro3({ shellyId, tenantId: tenant.id, kind: "panel", channels: ["אולם", "מזגן", "דוד"] });
    const block = await nextBlock();
    assert.ok(block);
    const runs = Array.from({ length: 21 }, (_, index) => ({
      deviceId,
      action: index % 2 === 0 ? ("ON" as const) : ("OFF" as const),
      runAt: new Date(Date.parse(block.start) + (index + 1) * 15 * 60_000).toISOString(),
      label: `פעולה ${index}`,
    }));
    await upsertProgram({
      id: programId,
      tenantId: tenant.id,
      programKey: "days:script",
      name: "גיבוי ארוך",
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
    await replaceProgramRuns(programId, runs);
    const saved = await syncShellyUnit(unit(tenant.id, shellyId, deviceId), device.rpc, now);
    assert.equal(saved.status, "verified");
    assert.equal(saved.mode, "script");
    assert.equal(saved.actionCount, 21);
    assert.deepEqual([...device.jobs.keys()], [7]);
    const code = [...device.scripts.values()][0]?.code ?? "";
    assert.equal(planFromScript(code)?.actions.length, 21);
    assert.equal(planHash(planFromScript(code)?.actions ?? [], { start: saved.windowStart ?? "", end: saved.windowEnd ?? "", label: "" }), saved.planHash);
  } finally {
    await deleteProgram(tenant.id, programId).catch(() => undefined);
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});

test("a clock that is not synced fails, retries, and alerts an admin once", async () => {
  const tenant = await createTenant({ name: "גיבוי שעון", phone: null });
  const shellyId = `shellyclock${String(Date.now()).slice(-6)}`;
  const deviceId = `${shellyId}_ch0`;
  const device = deviceOf(shellyId);
  device.drift = 600;
  try {
    await createShellyPro3({ shellyId, tenantId: tenant.id, kind: "panel", channels: ["אולם", "מזגן", "דוד"] });
    const target = unit(tenant.id, shellyId, deviceId);
    const first = await syncShellyUnit(target, device.rpc, now);
    assert.equal(first.status, "failed");
    assert.match(first.error ?? "", /אינו מסונכרן/);
    assert.equal(device.jobs.size, 1);
    await syncShellyUnit(target, device.rpc, new Date(now.getTime() + 1000));
    const third = await syncShellyUnit(target, device.rpc, new Date(now.getTime() + 2000));
    assert.equal(third.attempts, 3);
    assert.ok(third.alertedAt);
    await syncShellyUnit(target, device.rpc, new Date(now.getTime() + 3000));
    const alerts = (await listAudit({ role: "admin", tenantId: null }, 40)).filter((entry) => entry.action === "SHELLY_BACKUP" && entry.deviceId === deviceId);
    assert.equal(alerts.length, 1);
    const report = assessClock({ unixtime: Math.floor(now.getTime() / 1000) + 600 }, { location: { tz: "Asia/Jerusalem" } }, now);
    assert.equal(report.ok, false);
  } finally {
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});

test("a manual send writes the plan again and tells the Shelly to restore its last state after power returns", async () => {
  const tenant = await createTenant({ name: "שליחה ידנית", phone: null });
  const shellyId = `shellysend${String(Date.now()).slice(-6)}`;
  const deviceId = `${shellyId}_ch0`;
  const programId = `prog_${tenant.id}_send`;
  const device = deviceOf(shellyId);
  try {
    await createShellyPro3({ shellyId, tenantId: tenant.id, kind: "panel", channels: ["אולם", "מזגן", "דוד"] });
    const block = await nextBlock();
    assert.ok(block);
    await upsertProgram({
      id: programId,
      tenantId: tenant.id,
      programKey: "days:send",
      name: "גיבוי",
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
    await replaceProgramRuns(programId, [
      { deviceId, action: "ON", runAt: new Date(Date.parse(block.start) + 30 * 60_000).toISOString(), label: "הדלקה" },
      { deviceId, action: "OFF", runAt: new Date(Date.parse(block.start) + 90 * 60_000).toISOString(), label: "כיבוי" },
    ]);
    const target = unit(tenant.id, shellyId, deviceId);
    await syncShellyUnit(target, device.rpc, now);
    const before = device.creates;
    const again = await syncShellyUnit(target, device.rpc, now, { force: true });
    assert.equal(again.status, "verified");
    assert.ok(device.creates > before);
    assert.equal(device.initial.get(0), "restore_last");
    assert.equal(device.initial.get(1), "restore_last");
    assert.equal(device.initial.has(2), false);
  } finally {
    await deleteProgram(tenant.id, programId).catch(() => undefined);
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});

test("a monthly check leaves a healthy plan in place, rewrites a missing one, and waits a day when the Shelly is offline", async () => {
  const tenant = await createTenant({ name: "בדיקה חודשית", phone: null });
  const shellyId = `shellywatch${String(Date.now()).slice(-6)}`;
  const deviceId = `${shellyId}_ch0`;
  const programId = `prog_${tenant.id}_watch`;
  const device = deviceOf(shellyId);
  try {
    await createShellyPro3({ shellyId, tenantId: tenant.id, kind: "panel", channels: ["אולם", "מזגן", "דוד"] });
    const block = await nextBlock();
    assert.ok(block);
    await upsertProgram({
      id: programId,
      tenantId: tenant.id,
      programKey: "days:watch",
      name: "גיבוי",
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
    await replaceProgramRuns(programId, [
      { deviceId, action: "ON", runAt: new Date(Date.parse(block.start) + 30 * 60_000).toISOString(), label: "הדלקה" },
    ]);
    const target = unit(tenant.id, shellyId, deviceId);
    const saved = await syncShellyUnit(target, device.rpc, now);
    const creates = device.creates;
    const checked = await syncShellyUnit(target, device.rpc, now, { patrol: true });
    assert.equal(checked.status, "verified");
    assert.equal(device.creates, creates);
    assert.equal(Date.parse(checked.nextCheckAt ?? "") - now.getTime(), SHELLY_WATCH_EVERY_MS);

    device.scripts.clear();
    const repaired = await syncShellyUnit(target, device.rpc, now, { patrol: true });
    assert.equal(repaired.status, "verified");
    assert.ok(device.creates > creates);
    assert.ok([...device.scripts.values()].some((script) => script.code.includes("var PLAN")));

    device.offline = true;
    const later = new Date(now.getTime() + 60_000);
    const waiting = await syncShellyUnit(target, device.rpc, later, { patrol: true });
    assert.equal(waiting.status, "verified");
    assert.equal(Date.parse(waiting.nextCheckAt ?? "") - later.getTime(), SHELLY_WATCH_RETRY_MS);
  } finally {
    await deleteProgram(tenant.id, programId).catch(() => undefined);
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});

function unit(tenantId: string, shellyId: string, deviceId: string) {
  return {
    shellyId,
    tenantId,
    name: "אולם",
    channels: [
      { deviceId, channel: 0 as const, frozen: false },
      { deviceId: `${shellyId}_ch1`, channel: 1 as const, frozen: false },
      { deviceId: `${shellyId}_ch2`, channel: 2 as const, frozen: true },
    ],
  };
}

async function nextBlock() {
  const agenda = await upcomingAgenda(DEFAULT_CLOCK, now, 21);
  return mergeBackupBlock(
    agenda.map((window) => ({ title: window.programName, start: window.start, end: window.end })),
    now,
  );
}

function deviceOf(shellyId: string) {
  void shellyId;
  let tz = "Asia/Jerusalem";
  let drift = 0;
  let nextId = 10;
  let scriptSeq = 1;
  let creates = 0;
  let offline = false;
  const initial = new Map<number, string>();
  const jobs = new Map<number, { id: number; timespec: string; calls: Array<{ method: "Switch.Set"; params: { id: 0 | 1 | 2; on: boolean } }> }>();
  jobs.set(7, { id: 7, timespec: "0 0 12 * * *", calls: [{ method: "Switch.Set", params: { id: 0, on: true } }] });
  const scripts = new Map<number, { id: number; name: string; code: string; enable: boolean }>();
  const kvs = new Map<string, string>();
  const state = {
    jobs,
    scripts,
    get tz() {
      return tz;
    },
    set tz(value: string) {
      tz = value;
    },
    set drift(value: number) {
      drift = value;
    },
    get creates() {
      return creates;
    },
    set offline(value: boolean) {
      offline = value;
    },
    initial,
    corrupt: false,
  };
  const rpc: ShellyRpc = async (method, params = {}) => {
    if (offline) throw new Error("התקן Shelly אינו מחובר כעת");
    if (method === "Sys.GetStatus") return { unixtime: Math.floor(now.getTime() / 1000) + drift };
    if (method === "Switch.GetConfig") return { id: params.id, initial_state: initial.get(Number(params.id)) ?? "off" };
    if (method === "Switch.SetConfig") {
      const config = params.config as { initial_state?: string } | undefined;
      if (config?.initial_state) initial.set(Number(params.id), config.initial_state);
      return {};
    }
    if (method === "Sys.GetConfig") return { location: { tz } };
    if (method === "Sys.SetConfig") {
      const next = (params.location as { tz?: string } | undefined)?.tz;
      if (next) tz = next;
      return {};
    }
    if (method === "Schedule.List") {
      const rows = [...jobs.values()].map((job) => ({ ...job, calls: job.calls.map((call) => ({ ...call, params: { ...call.params } })) }));
      if (state.corrupt) return { jobs: rows.map((job) => (job.id === 7 ? job : { ...job, timespec: "0 1 1 1 1 *" })) };
      return { jobs: rows };
    }
    if (method === "Schedule.Delete") {
      jobs.delete(Number(params.id));
      return {};
    }
    if (method === "Schedule.Create") {
      creates += 1;
      const id = nextId++;
      jobs.set(id, {
        id,
        timespec: String(params.timespec),
        calls: params.calls as Array<{ method: "Switch.Set"; params: { id: 0 | 1 | 2; on: boolean } }>,
      });
      return { id };
    }
    if (method === "KVS.Get") {
      if (!kvs.has(String(params.key))) throw new Error("missing");
      return { value: kvs.get(String(params.key)) };
    }
    if (method === "KVS.Set") {
      kvs.set(String(params.key), String(params.value ?? ""));
      return {};
    }
    if (method === "Script.List") return { scripts: [...scripts.values()].map((script) => ({ id: script.id, name: script.name, enable: script.enable })) };
    if (method === "Script.Create") {
      const id = scriptSeq++;
      scripts.set(id, { id, name: String(params.name ?? ""), code: "", enable: false });
      return { id };
    }
    if (method === "Script.Stop" || method === "Script.Start") return {};
    if (method === "Script.PutCode") {
      const script = scripts.get(Number(params.id));
      if (!script) throw new Error("אין סקריפט");
      const chunk = String(params.code ?? "");
      script.code = params.append ? script.code + chunk : chunk;
      return {};
    }
    if (method === "Script.SetConfig") {
      const script = scripts.get(Number(params.id));
      const config = params.config as { enable?: boolean } | undefined;
      if (script && config) script.enable = Boolean(config.enable);
      return {};
    }
    if (method === "Script.GetCode") {
      const script = scripts.get(Number(params.id));
      const offset = Number(params.offset ?? 0);
      const len = Number(params.len ?? 1024);
      return { data: (script?.code ?? "").slice(offset, offset + len) };
    }
    throw new Error(method);
  };
  return Object.assign(state, { rpc });
}

function play(code: string, startSeconds: number, methods: Set<string>, kvs = new Map<string, string>()) {
  const switches: Array<{ id: number; on: boolean }> = [];
  const deleted: number[] = [];
  let nowSeconds = startSeconds;
  let timer: (() => void) | null = null;
  const sandbox = {
    Date: { now: () => nowSeconds * 1000 },
    Math,
    Shelly: {
      call(method: string, params: { id?: number; on?: boolean; key?: string; value?: string }, callback?: (result: unknown, err: number) => void) {
        methods.add(method);
        if (method === "Switch.Set") switches.push({ id: Number(params.id), on: Boolean(params.on) });
        if (method === "Schedule.Delete") deleted.push(Number(params.id));
        if (method === "KVS.Set") kvs.set(String(params.key), String(params.value ?? ""));
        if (method === "KVS.Get") {
          const value = kvs.get(String(params.key));
          callback?.(value == null ? null : { value }, value == null ? 1 : 0);
          return;
        }
        callback?.({}, 0);
      },
    },
    Timer: {
      set(_ms: number, _repeat: boolean, fn: () => void) {
        timer = fn;
      },
    },
  };
  vm.runInNewContext(code, sandbox, { timeout: 1000 });
  return {
    switches,
    deleted,
    kvs,
    advance(to: number) {
      nowSeconds = to;
      const fn = timer;
      timer = null;
      fn?.();
    },
  };
}
