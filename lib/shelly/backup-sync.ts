import { upcomingAgenda } from "@/lib/hebrew/calendar";
import {
  actionsForUnit,
  assessClock,
  chooseBackupMode,
  jobsFor,
  jobSignature,
  mergeBackupBlock,
  planHash,
  sameJobs,
  shouldPushBackup,
  type BackupAction,
  type BackupBlock,
  type ScheduleJob,
} from "@/lib/shelly/backup-plan";
import { expiryFromScript, expiryScript, idleScript, planFromScript, planScript, scriptName } from "@/lib/shelly/backup-script";
import { parseShellyChannelId, type ShellyChannel } from "@/lib/shelly/ids";
import { getShellyHub } from "@/lib/shelly/hub";
import type { ShellyBackupRow } from "@/lib/shelly/backup-record";
import {
  addAudit,
  getClock,
  getShellyBackup,
  listProgramRuns,
  listShellyBackups,
  listTenantDevices,
  listTenants,
  saveShellyBackup,
} from "@/lib/store";

const ALERT_AFTER = 3;
const RETRY_AFTER_ALERT_MS = 5 * 60_000;
const touched = new Map<string, number>();

export type ShellyRpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export type ShellyBackupView = {
  shellyId: string;
  name: string;
  status: ShellyBackupRow["status"];
  mode: ShellyBackupRow["mode"];
  windowLabel: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  actionCount: number;
  syncedAt: string | null;
  verifiedAt: string | null;
  error: string | null;
};

export type ShellyBackupUnit = {
  shellyId: string;
  tenantId: string;
  name: string;
  channels: Array<{ deviceId: string; channel: ShellyChannel; frozen: boolean }>;
};

export async function syncShellyBackups(now = new Date()) {
  const tenants = await listTenants();
  for (const tenant of tenants) {
    for (const unit of await unitsOf(tenant.id)) {
      const at = touched.get(unit.shellyId) ?? 0;
      if (Date.now() - at < 60_000) continue;
      touched.set(unit.shellyId, Date.now());
      await syncUnitOnline(unit, now);
    }
  }
}

export async function syncShellyBackupsForTenant(tenantId: string, now = new Date()) {
  for (const unit of await unitsOf(tenantId)) {
    touched.set(unit.shellyId, Date.now());
    await syncUnitOnline(unit, now);
  }
}

export async function shellyBackupViews(tenantId: string): Promise<ShellyBackupView[]> {
  const units = await unitsOf(tenantId);
  if (!units.length) return [];
  const saved = new Map((await listShellyBackups(tenantId)).map((row) => [row.shellyId, row]));
  return units.map((unit) => {
    const row = saved.get(unit.shellyId);
    return {
      shellyId: unit.shellyId,
      name: unit.name,
      status: row?.status ?? "idle",
      mode: row?.mode ?? null,
      windowLabel: row?.windowLabel ?? null,
      windowStart: row?.windowStart ?? null,
      windowEnd: row?.windowEnd ?? null,
      actionCount: row?.actionCount ?? 0,
      syncedAt: row?.syncedAt ?? null,
      verifiedAt: row?.verifiedAt ?? null,
      error: row?.error ?? null,
    };
  });
}

/** Server-side program runs inside a verified local window must not be sent again. WLTE ids never match. */
export async function shellyBackupCoversRun(deviceId: string, runAt: string): Promise<boolean> {
  const parsed = parseShellyChannelId(deviceId);
  if (!parsed) return false;
  const row = await getShellyBackup(parsed.shellyId);
  if (!row || row.status !== "verified" || !row.windowStart || !row.windowEnd) return false;
  const at = Date.parse(runAt);
  return at >= Date.parse(row.windowStart) && at <= Date.parse(row.windowEnd);
}

export async function syncShellyUnit(unit: ShellyBackupUnit, rpc: ShellyRpc, now = new Date()): Promise<ShellyBackupRow> {
  const previous = await getShellyBackup(unit.shellyId);
  const block = await blockFor(unit.tenantId, now);
  if (!block || !shouldPushBackup(block, now)) {
    return saveShellyBackup({
      ...(previous ?? emptyRow(unit)),
      tenantId: unit.tenantId,
      status: "idle",
      windowStart: block?.start ?? null,
      windowEnd: block?.end ?? null,
      windowLabel: block?.label ?? null,
      error: null,
      updatedAt: now.toISOString(),
    });
  }
  if (previous?.status === "failed" && previous.attempts >= ALERT_AFTER && now.getTime() - Date.parse(previous.updatedAt) < RETRY_AFTER_ALERT_MS) {
    return previous;
  }

  const runs = await listProgramRuns(unit.tenantId);
  const channels = new Map(unit.channels.map((channel) => [channel.deviceId, channel]));
  const actions = actionsForUnit(runs, unit.shellyId, channels, block, now);
  const hash = planHash(actions, block);
  if (
    previous?.status === "verified" &&
    previous.planHash === hash &&
    previous.windowStart === block.start &&
    previous.windowEnd === block.end
  ) {
    return previous;
  }

  await saveShellyBackup({
    ...(previous ?? emptyRow(unit)),
    tenantId: unit.tenantId,
    status: "pending",
    windowStart: block.start,
    windowEnd: block.end,
    windowLabel: block.label,
    planHash: hash,
    actionCount: actions.length,
    error: null,
    updatedAt: now.toISOString(),
  });

  try {
    await ensureClock(rpc, now);
    const endSeconds = Math.floor(Date.parse(block.end) / 1000);
    const written = await writePlan(rpc, actions, endSeconds, previous?.scheduleIds ?? [], now >= new Date(block.start));
    await verifyPlan(rpc, written, actions, endSeconds);
    const saved = await saveShellyBackup({
      ...(previous ?? emptyRow(unit)),
      tenantId: unit.tenantId,
      status: "verified",
      mode: written.mode,
      windowStart: block.start,
      windowEnd: block.end,
      windowLabel: block.label,
      planHash: hash,
      actionCount: actions.length,
      scheduleIds: written.ids,
      syncedAt: now.toISOString(),
      verifiedAt: now.toISOString(),
      error: null,
      attempts: 0,
      alertedAt: null,
      updatedAt: now.toISOString(),
    });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : "סנכרון הגיבוי נכשל";
    const attempts = (previous?.attempts ?? 0) + 1;
    let alertedAt = previous?.alertedAt ?? null;
    if (attempts >= ALERT_AFTER && !alertedAt) {
      alertedAt = now.toISOString();
      await addAudit({
        source: "system",
        actor: "מערכת",
        deviceId: unit.channels[0]?.deviceId ?? null,
        action: "SHELLY_BACKUP",
        idempotencyKey: null,
        result: "FAILED",
        detail: `${unit.name}: ${message}`.slice(0, 300),
      });
    }
    return saveShellyBackup({
      ...(previous ?? emptyRow(unit)),
      tenantId: unit.tenantId,
      status: "failed",
      windowStart: block.start,
      windowEnd: block.end,
      windowLabel: block.label,
      planHash: hash,
      actionCount: actions.length,
      error: message,
      attempts,
      alertedAt,
      updatedAt: now.toISOString(),
    });
  }
}

async function syncUnitOnline(unit: ShellyBackupUnit, now: Date) {
  const online = getShellyHub().isOnline(unit.shellyId);
  const rpc: ShellyRpc = online
    ? (method, params) => getShellyHub().rpc(unit.shellyId, method, params)
    : async () => {
        throw new Error("התקן Shelly אינו מחובר כעת");
      };
  await syncShellyUnit(unit, rpc, now);
}

async function blockFor(tenantId: string, now: Date): Promise<BackupBlock | null> {
  const settings = await getClock(tenantId);
  const agenda = await upcomingAgenda(settings, now, 21);
  return mergeBackupBlock(
    agenda.map((window) => ({ title: window.programName, start: window.start, end: window.end })),
    now,
  );
}

async function unitsOf(tenantId: string): Promise<ShellyBackupUnit[]> {
  const devices = (await listTenantDevices(tenantId)).filter((device) => device.vendor === "shelly" && device.externalId);
  const grouped = new Map<string, ShellyBackupUnit>();
  for (const device of devices) {
    const parsed = parseShellyChannelId(device.deviceId);
    if (!parsed) continue;
    const shellyId = parsed.shellyId;
    const unit = grouped.get(shellyId) ?? { shellyId, tenantId, name: "", channels: [] };
    unit.channels.push({ deviceId: device.deviceId, channel: parsed.channel, frozen: device.frozen });
    grouped.set(shellyId, unit);
  }
  for (const unit of grouped.values()) {
    unit.channels.sort((left, right) => left.channel - right.channel);
    unit.name = unit.channels.length ? unit.channels.map((channel) => devices.find((device) => device.deviceId === channel.deviceId)?.name ?? "").filter(Boolean).join(" · ") : unit.shellyId;
  }
  return [...grouped.values()];
}

async function ensureClock(rpc: ShellyRpc, now: Date) {
  let status = await rpc("Sys.GetStatus");
  let config = await rpc("Sys.GetConfig");
  let report = assessClock(status, config, now);
  if (report.needTimezone) {
    await rpc("Sys.SetConfig", { location: { tz: "Asia/Jerusalem" } });
    config = await rpc("Sys.GetConfig");
    status = await rpc("Sys.GetStatus");
    report = assessClock(status, config, now);
  }
  if (report.needTimezone || report.timezone !== "Asia/Jerusalem") {
    throw new Error("אזור הזמן של ההתקן אינו Asia/Jerusalem");
  }
  if (report.driftSeconds == null || Math.abs(report.driftSeconds) > 45) {
    throw new Error("השעון הפנימי של ההתקן אינו מסונכרן");
  }
}

type Written = { mode: "schedule" | "script"; ids: number[]; jobs: ScheduleJob[] };

async function writePlan(rpc: ShellyRpc, actions: BackupAction[], endSeconds: number, rememberedIds: number[], windowStarted: boolean): Promise<Written> {
  const listed = await listSchedules(rpc);
  const owned = new Set<number>([...rememberedIds, ...(await kvsIds(rpc))]);
  for (const id of owned) {
    if (listed.some((job) => job.id === id)) await rpc("Schedule.Delete", { id });
  }
  const foreign = listed.filter((job) => !owned.has(job.id)).length;
  const jobs = jobsFor(actions);
  let mode = actions.length ? chooseBackupMode({ jobCount: jobs.length, foreignSchedules: foreign, windowStarted }) : "script";
  let ids: number[] = [];
  if (mode === "schedule") {
    try {
      for (const job of jobs) {
        const created = await rpc("Schedule.Create", { enable: true, timespec: job.timespec, calls: job.calls });
        const id = readId(created);
        if (id == null) throw new Error("ההתקן לא החזיר מזהה שעון");
        ids.push(id);
      }
    } catch (error) {
      for (const id of ids) await rpc("Schedule.Delete", { id }).catch(() => undefined);
      ids = [];
      mode = "script";
      if (!(error instanceof Error)) throw error;
    }
  }
  if (mode === "script") {
    const code = actions.length ? planScript(actions, endSeconds) : idleScript();
    await installScript(rpc, code, actions.length > 0);
  } else {
    await installScript(rpc, expiryScript(ids, endSeconds), true);
  }
  await rpc("KVS.Set", { key: "pikud/ids", value: ids.join(",") });
  return { mode, ids, jobs: mode === "schedule" ? jobs : [] };
}

async function verifyPlan(rpc: ShellyRpc, written: Written, actions: BackupAction[], endSeconds: number) {
  const listed = await listSchedules(rpc);
  const code = await readScript(rpc);
  if (written.mode === "schedule") {
    const ours = listed.filter((job) => written.ids.includes(job.id));
    if (ours.length !== written.jobs.length || !sameJobs(written.jobs, ours)) {
      throw new Error("השעונים שנקראו מההתקן לא תואמים את התכנון");
    }
    const expiry = code ? expiryFromScript(code) : null;
    if (!expiry || expiry.end !== endSeconds || expiry.ids.join(",") !== written.ids.join(",")) {
      throw new Error("סקריפט ניקוי השעונים בהתקן לא תואם את התכנון");
    }
    return;
  }
  const leftover = listed.filter((job) => written.ids.includes(job.id));
  if (leftover.length) throw new Error("נשארו שעוני גיבוי ישנים על ההתקן");
  if (!actions.length) return;
  const plan = code ? planFromScript(code) : null;
  if (!plan || plan.end !== endSeconds || plan.actions.length !== actions.length) {
    throw new Error("התוכנית שנקראה מההתקן לא תואמת את התכנון");
  }
  const expected = actions.map((action) => jobSignature({ timespec: String(action.at), calls: [{ method: "Switch.Set", params: { id: action.channel, on: action.on } }] })).sort();
  const actual = plan.actions.map((action) => jobSignature({ timespec: String(action.at), calls: [{ method: "Switch.Set", params: { id: action.channel, on: action.on } }] })).sort();
  if (expected.some((value, index) => value !== actual[index])) {
    throw new Error("השעות, הערוצים או הפעולות בהתקן לא תואמים את התכנון");
  }
}

async function installScript(rpc: ShellyRpc, code: string, enable: boolean) {
  const scripts = await listScripts(rpc);
  const name = scriptName();
  let id: number | null = scripts.find((script) => script.name === name)?.id ?? null;
  if (id == null) {
    id = readId(await rpc("Script.Create", { name }));
    if (id == null) throw new Error("לא ניתן ליצור סקריפט על ההתקן");
  } else {
    await rpc("Script.Stop", { id }).catch(() => undefined);
  }
  const size = 900;
  for (let offset = 0; offset < code.length; offset += size) {
    await rpc("Script.PutCode", { id, code: code.slice(offset, offset + size), append: offset > 0 });
  }
  await rpc("Script.SetConfig", { id, config: { enable, name } });
  if (enable) await rpc("Script.Start", { id });
}

async function readScript(rpc: ShellyRpc): Promise<string | null> {
  const scripts = await listScripts(rpc);
  const id = scripts.find((script) => script.name === scriptName())?.id;
  if (id == null) return null;
  let code = "";
  for (let offset = 0; offset < 64_000; offset += 1024) {
    const chunk = await rpc("Script.GetCode", { id, offset, len: 1024 });
    const data = readCode(chunk);
    code += data;
    if (data.length < 1024) break;
  }
  return code;
}

async function listSchedules(rpc: ShellyRpc): Promise<Array<{ id: number; timespec: string; calls: ScheduleJob["calls"] }>> {
  const result = await rpc("Schedule.List");
  const rows = unwrapList(result, ["jobs", "schedules"]);
  return rows
    .map((row) => {
      const id = readId(row);
      if (id == null || !row || typeof row !== "object") return null;
      const record = row as { timespec?: unknown; calls?: unknown };
      const calls = Array.isArray(record.calls) ? (record.calls as ScheduleJob["calls"]) : [];
      return { id, timespec: typeof record.timespec === "string" ? record.timespec : "", calls };
    })
    .filter((row): row is { id: number; timespec: string; calls: ScheduleJob["calls"] } => Boolean(row));
}

async function listScripts(rpc: ShellyRpc): Promise<Array<{ id: number; name: string }>> {
  const result = await rpc("Script.List");
  return unwrapList(result, ["scripts"])
    .map((row) => {
      const id = readId(row);
      if (id == null || !row || typeof row !== "object") return null;
      const name = (row as { name?: unknown }).name;
      return { id, name: typeof name === "string" ? name : "" };
    })
    .filter((row): row is { id: number; name: string } => Boolean(row));
}

async function kvsIds(rpc: ShellyRpc): Promise<number[]> {
  try {
    const result = await rpc("KVS.Get", { key: "pikud/ids" });
    const value = readKvs(result);
    return value
      .split(",")
      .map((part) => Number(part))
      .filter((id) => Number.isInteger(id) && id >= 0);
  } catch {
    return [];
  }
}

function unwrapList(result: unknown, keys: string[]): unknown[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function readId(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}

function readCode(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const data = (value as { data?: unknown }).data;
  return typeof data === "string" ? data : "";
}

function readKvs(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const stored = (value as { value?: unknown }).value;
  return typeof stored === "string" ? stored : "";
}

function emptyRow(unit: ShellyBackupUnit): ShellyBackupRow {
  return {
    shellyId: unit.shellyId,
    tenantId: unit.tenantId,
    status: "idle",
    mode: null,
    windowStart: null,
    windowEnd: null,
    windowLabel: null,
    planHash: null,
    actionCount: 0,
    scheduleIds: [],
    syncedAt: null,
    verifiedAt: null,
    error: null,
    attempts: 0,
    alertedAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}
