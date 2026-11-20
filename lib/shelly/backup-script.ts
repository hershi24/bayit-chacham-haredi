import type { BackupAction } from "@/lib/shelly/backup-plan";

const MARK = "pikud-shabbat";

export function scriptName() {
  return MARK;
}

/** Plan stored in the script body. Absolute timestamps do not recur next year. */
export function planScript(actions: BackupAction[], endSeconds: number): string {
  const plan = JSON.stringify(actions.map((action) => [action.at, action.channel, action.on ? 1 : 0]));
  return `"use strict";
var PLAN = ${plan};
var END = ${Math.floor(endSeconds)};
var booted = 0;
var fired = {};

function applyEdge(edge) {
  Shelly.call("Switch.Set", { id: edge[1], on: edge[2] ? true : false });
}

function catchUp(now) {
  var seen = {};
  var i;
  var channel;
  if (now < 1700000000 || now > END + 180) return;
  for (i = PLAN.length - 1; i >= 0; i--) {
    channel = PLAN[i][1];
    if (seen[channel]) continue;
    if (PLAN[i][0] <= now && now - PLAN[i][0] < 43200) {
      seen[channel] = 1;
      applyEdge(PLAN[i]);
      fired[i] = 1;
    }
  }
}

function fireDue(now) {
  var i;
  if (now < 1700000000 || now > END + 180) return;
  for (i = 0; i < PLAN.length; i++) {
    if (!fired[i] && PLAN[i][0] <= now && now - PLAN[i][0] < 90) {
      applyEdge(PLAN[i]);
      fired[i] = 1;
    }
  }
}

function waitMs(now) {
  var i;
  var next = -1;
  var delta;
  if (now > END + 180) return 3600000;
  for (i = 0; i < PLAN.length; i++) {
    if (!fired[i] && (next < 0 || PLAN[i][0] < PLAN[next][0])) next = i;
  }
  if (next < 0) return 60000;
  delta = (PLAN[next][0] - now) * 1000;
  if (delta < 1000) return 1000;
  if (delta > 60000) return 60000;
  return delta;
}

function persist() {
  var bits = "";
  var i;
  for (i = 0; i < PLAN.length; i++) bits += fired[i] ? "1" : "0";
  Shelly.call("KVS.Set", { key: "pikud/fired", value: bits });
}

function tick() {
  var now = Math.floor(Date.now() / 1000);
  if (!booted) {
    booted = 1;
    catchUp(now);
    persist();
  } else {
    fireDue(now);
    persist();
  }
  Timer.set(waitMs(now), false, tick);
}

function start() {
  Shelly.call("KVS.Get", { key: "pikud/fired" }, function (res, err) {
    var bits = "";
    var i;
    if (!err && res && typeof res.value === "string") bits = res.value;
    for (i = 0; i < PLAN.length; i++) {
      if (bits.charAt(i) === "1") fired[i] = 1;
    }
    tick();
  });
}

start();
`;
}

/** Deletes only our schedule ids after the window, so a dated cron cannot fire next year. */
export function expiryScript(ids: number[], endSeconds: number): string {
  return `"use strict";
var IDS = ${JSON.stringify(ids)};
var END = ${Math.floor(endSeconds)};
var cleared = 0;

function tick() {
  var now = Math.floor(Date.now() / 1000);
  var i;
  if (!cleared && now > 1700000000 && now > END + 180) {
    cleared = 1;
    for (i = 0; i < IDS.length; i++) Shelly.call("Schedule.Delete", { id: IDS[i] });
    Shelly.call("KVS.Set", { key: "pikud/ids", value: "" });
    return;
  }
  Timer.set(60000, false, tick);
}

tick();
`;
}

export function idleScript(): string {
  return `"use strict";
var PLAN = [];
var END = 0;
`;
}

export function planFromScript(code: string): { actions: BackupAction[]; end: number } | null {
  const plan = /var PLAN = (\[[\s\S]*?\]);/.exec(code);
  const end = /var END = (\d+);/.exec(code);
  if (!plan || !end) return null;
  const rows = JSON.parse(plan[1]) as unknown;
  if (!Array.isArray(rows)) return null;
  const actions: BackupAction[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) return null;
    const at = Number(row[0]);
    const channel = Number(row[1]);
    const on = Number(row[2]) === 1;
    if (!Number.isFinite(at) || (channel !== 0 && channel !== 1 && channel !== 2)) return null;
    actions.push({ at, channel, on });
  }
  return { actions, end: Number(end[1]) };
}

export function expiryFromScript(code: string): { ids: number[]; end: number } | null {
  const ids = /var IDS = (\[[\s\S]*?\]);/.exec(code);
  const end = /var END = (\d+);/.exec(code);
  if (!ids || !end) return null;
  const parsed = JSON.parse(ids[1]) as unknown;
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "number")) return null;
  return { ids: parsed as number[], end: Number(end[1]) };
}
