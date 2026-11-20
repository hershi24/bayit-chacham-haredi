import { createHash } from "node:crypto";
import type { ShellyChannel } from "@/lib/shelly/ids";
import { parseShellyChannelId } from "@/lib/shelly/ids";

/** Shelly Pro keeps at most 20 schedule jobs, and each job runs at most 5 calls. */
export const SHELLY_SCHEDULE_LIMIT = 20;
export const SHELLY_CALLS_PER_JOB = 5;

/** Push the next Shabbat or holiday once it is inside this horizon, and again after every edit. */
export const BACKUP_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

/** Holiday and Shabbat are "attached" when one begins within this gap of the other ending. */
const ADJACENT_MS = 3 * 60 * 60 * 1000;

export type BackupWindow = {
  title: string;
  start: string;
  end: string;
};

export type BackupBlock = {
  start: string;
  end: string;
  label: string;
};

export type BackupAction = {
  /** Unix seconds, absolute. A past year cannot match this stamp. */
  at: number;
  channel: ShellyChannel;
  on: boolean;
};

export type ScheduleCall = {
  method: "Switch.Set";
  params: { id: ShellyChannel; on: boolean };
};

export type ScheduleJob = {
  timespec: string;
  calls: ScheduleCall[];
};

export type BackupMode = "schedule" | "script";

export function mergeBackupBlock(windows: BackupWindow[], now: Date): BackupBlock | null {
  const upcoming = windows
    .map((window) => ({ ...window, startMs: Date.parse(window.start), endMs: Date.parse(window.end) }))
    .filter((window) => Number.isFinite(window.startMs) && Number.isFinite(window.endMs) && window.endMs > now.getTime())
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const first = upcoming[0];
  if (!first) return null;
  let endMs = first.endMs;
  const titles = [first.title];
  for (const next of upcoming.slice(1)) {
    if (next.startMs > endMs + ADJACENT_MS) break;
    endMs = Math.max(endMs, next.endMs);
    if (!titles.includes(next.title)) titles.push(next.title);
  }
  return { start: new Date(first.startMs).toISOString(), end: new Date(endMs).toISOString(), label: titles.join(" · ") };
}

export function shouldPushBackup(block: BackupBlock, now: Date) {
  const start = Date.parse(block.start);
  const end = Date.parse(block.end);
  if (!(end > now.getTime())) return false;
  if (now.getTime() >= start) return true;
  return start - now.getTime() <= BACKUP_LEAD_MS;
}

export function actionsForUnit(
  runs: Array<{ deviceId: string; action: "ON" | "OFF"; runAt: string }>,
  shellyId: string,
  channels: ReadonlyMap<string, { channel: ShellyChannel; frozen: boolean }>,
  block: BackupBlock,
  now: Date,
): BackupAction[] {
  const start = Date.parse(block.start);
  const end = Date.parse(block.end);
  const notBefore = Math.max(start, now.getTime() - 30_000);
  const actions: BackupAction[] = [];
  for (const run of runs) {
    const atMs = Date.parse(run.runAt);
    if (!Number.isFinite(atMs) || atMs < notBefore || atMs > end) continue;
    const parsed = parseShellyChannelId(run.deviceId);
    if (!parsed || parsed.shellyId !== shellyId) continue;
    const channel = channels.get(run.deviceId);
    if (!channel || channel.frozen) continue;
    actions.push({ at: Math.floor(atMs / 1000), channel: channel.channel, on: run.action === "ON" });
  }
  actions.sort((left, right) => left.at - right.at || left.channel - right.channel || Number(right.on) - Number(left.on));
  return actions;
}

/** Cron with no leading zeros. The date is day-of-month and month, so it is not a weekly loop. */
export function shellyTimespec(atSeconds: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "numeric",
    minute: "numeric",
    day: "numeric",
    month: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(atSeconds * 1000));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return `0 ${read("minute")} ${read("hour")} ${read("day")} ${read("month")} *`;
}

export function jobsFor(actions: BackupAction[]): ScheduleJob[] {
  const groups = new Map<string, BackupAction[]>();
  for (const action of actions) {
    const key = shellyTimespec(action.at);
    const list = groups.get(key) ?? [];
    list.push(action);
    groups.set(key, list);
  }
  const jobs: ScheduleJob[] = [];
  for (const [timespec, list] of groups) {
    for (let index = 0; index < list.length; index += SHELLY_CALLS_PER_JOB) {
      jobs.push({
        timespec,
        calls: list.slice(index, index + SHELLY_CALLS_PER_JOB).map((action) => ({
          method: "Switch.Set" as const,
          params: { id: action.channel, on: action.on },
        })),
      });
    }
  }
  return jobs;
}

/**
 * Native schedules are used only before the holy time starts and only when every
 * job fits beside the schedules the customer already saved on the device.
 * After entry, or when the device is full, the plan lives in one local script.
 */
export function chooseBackupMode(input: { jobCount: number; foreignSchedules: number; windowStarted: boolean }): BackupMode {
  if (input.windowStarted || input.jobCount <= 0) return "script";
  const free = SHELLY_SCHEDULE_LIMIT - input.foreignSchedules;
  if (input.jobCount <= free) return "schedule";
  return "script";
}

export function planHash(actions: BackupAction[], block: BackupBlock): string {
  return createHash("sha256")
    .update(JSON.stringify({ start: block.start, end: block.end, actions }))
    .digest("hex")
    .slice(0, 16);
}

export function jobSignature(job: { timespec: string; calls: Array<{ method?: string; params?: { id?: number; on?: boolean } }> }) {
  const calls = job.calls
    .map((call) => `${call.method ?? ""}:${call.params?.id ?? ""}:${call.params?.on ? 1 : 0}`)
    .join(",");
  return `${job.timespec}|${calls}`;
}

export function sameJobs(expected: ScheduleJob[], actual: Array<{ timespec: string; calls: ScheduleCall[] }>) {
  const left = expected.map(jobSignature).sort();
  const right = actual.map(jobSignature).sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export type ClockReport = {
  ok: boolean;
  timezone: string | null;
  driftSeconds: number | null;
  needTimezone: boolean;
};

export function assessClock(status: unknown, config: unknown, now: Date): ClockReport {
  const timezone = readTimezone(config) ?? readTimezone(status);
  const unixtime = readUnixtime(status);
  const driftSeconds = unixtime == null ? null : unixtime - Math.floor(now.getTime() / 1000);
  const needTimezone = timezone !== "Asia/Jerusalem";
  const driftOk = driftSeconds != null && Math.abs(driftSeconds) <= 45;
  return { ok: !needTimezone && driftOk, timezone, driftSeconds, needTimezone };
}

function readTimezone(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { location?: { tz?: unknown }; tz?: unknown };
  if (typeof record.location?.tz === "string" && record.location.tz) return record.location.tz;
  if (typeof record.tz === "string" && record.tz) return record.tz;
  return null;
}

function readUnixtime(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const unixtime = (value as { unixtime?: unknown }).unixtime;
  return typeof unixtime === "number" && Number.isFinite(unixtime) ? unixtime : null;
}
