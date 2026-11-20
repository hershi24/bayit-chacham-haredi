import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { upcomingAgenda } from "../lib/hebrew/calendar";
import { DEFAULT_CLOCK } from "../lib/hebrew/calendar";
import {
  assessClock,
  chooseBackupMode,
  mergeBackupBlock,
  planHash,
  shellyTimespec,
  SHELLY_SCHEDULE_LIMIT,
  type BackupAction,
} from "../lib/shelly/backup-plan";
import { expiryScript, planFromScript, planScript } from "../lib/shelly/backup-script";
import { shellyBackupCoversRun, syncShellyUnit, type ShellyRpc } from "../lib/shelly/backup-sync";
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

  const expiry = play(expiryScript([4, 9], start + 86_400), start + 86_400 + 400, new Set());
  assert.deepEqual(expiry.deleted, [4, 9]);
  assert.equal(expiry.switches.length, 0);
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
    corrupt: false,
  };
  const rpc: ShellyRpc = async (method, params = {}) => {
    if (method === "Sys.GetStatus") return { unixtime: Math.floor(now.getTime() / 1000) + drift };
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
