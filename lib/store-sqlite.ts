import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SqlValue } from "node:sqlite";
import { HttpError } from "@/lib/http-error";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { ClockSettings } from "@/lib/hebrew/calendar";
import { DEFAULT_CLOCK } from "@/lib/hebrew/calendar";
import type { PendingSchedule, ScheduleKind } from "@/lib/schedules/types";
import { resolveDateClocks } from "@/lib/programs/dates";
import { parseSlots } from "@/lib/programs/slots";
import type { DayClock, ProgramRun, ProgramRunInput, StoredProgram } from "@/lib/programs/types";
import type {
  AuditSource,
  AuditView,
  CallerNumber,
  Connectivity,
  DeviceView,
  Role,
  SessionUser,
  TenantView,
  UserView,
} from "@/lib/types";
import { isNewerIso } from "@/lib/wlte/parse";

type Row = Record<string, SqlValue>;

const globalDb = globalThis as unknown as { __pikudDb?: DatabaseSync };
let dayClocksReady = false;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function textOrNull(row: Row, key: string): string | null {
  const value = text(row, key);
  return value ? value : null;
}

function relayValue(value: SqlValue | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function db(): DatabaseSync {
  if (!globalDb.__pikudDb) {
    const dir = path.join(process.cwd(), ".data");
    fs.mkdirSync(dir, { recursive: true });
    const database = new DatabaseSync(path.join(dir, "pikud.sqlite"));
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 3000");
    migrate(database);
    seed(database);
    ensureAccessTables(database);
    globalDb.__pikudDb = database;
  }
  if (!dayClocksReady) {
    ensureDayClocks(globalDb.__pikudDb);
    addDeviceColumn(globalDb.__pikudDb, "icon", "icon TEXT");
    addDeviceColumn(globalDb.__pikudDb, "frozen", "frozen INTEGER NOT NULL DEFAULT 0");
    ensureAccessTables(globalDb.__pikudDb);
    dayClocksReady = true;
  }
  addDeviceColumn(globalDb.__pikudDb, "frozen", "frozen INTEGER NOT NULL DEFAULT 0");
  addDeviceColumn(globalDb.__pikudDb, "vendor", "vendor TEXT NOT NULL DEFAULT 'wlte'");
  addDeviceColumn(globalDb.__pikudDb, "kind", "kind TEXT NOT NULL DEFAULT 'socket'");
  addDeviceColumn(globalDb.__pikudDb, "external_id", "external_id TEXT");
  addDeviceColumn(globalDb.__pikudDb, "channel", "channel INTEGER");
  return globalDb.__pikudDb;
}

function addColumn(database: DatabaseSync, name: string, definition: string) {
  const columns = database.prepare("PRAGMA table_info(programs)").all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === name)) return;
  try {
    database.exec(`ALTER TABLE programs ADD COLUMN ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/duplicate column/i.test(message)) throw error;
  }
}

function addDeviceColumn(database: DatabaseSync, name: string, definition: string) {
  const columns = database.prepare("PRAGMA table_info(devices)").all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === name)) return;
  try {
    database.exec(`ALTER TABLE devices ADD COLUMN ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/duplicate column/i.test(message)) throw error;
  }
}

function ensureDayClocks(database: DatabaseSync) {
  addColumn(database, "days", "days TEXT NOT NULL DEFAULT '[]'");
  addColumn(database, "weekdays", "weekdays TEXT NOT NULL DEFAULT '[]'");
  addColumn(database, "on_time", "on_time TEXT");
  addColumn(database, "off_time", "off_time TEXT");
  addColumn(database, "slots", "slots TEXT NOT NULL DEFAULT '[]'");
  addColumn(database, "skipped_dates", "skipped_dates TEXT NOT NULL DEFAULT '[]'");
  database.exec(`
    CREATE TABLE IF NOT EXISTS clocks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      program_id TEXT,
      day TEXT NOT NULL,
      on_time TEXT,
      off_time TEXT,
      device_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS clocks_tenant_day_idx ON clocks (tenant_id, day);
  `);
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT REFERENCES tenants(id),
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'operator')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      icon TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_state (
      device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
      connectivity TEXT NOT NULL,
      relay_on INTEGER,
      state_updated_at TEXT,
      device_type TEXT,
      api_name TEXT,
      sensor_summary TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      source TEXT NOT NULL,
      actor TEXT NOT NULL,
      device_id TEXT,
      action TEXT NOT NULL,
      idempotency_key TEXT,
      result TEXT NOT NULL,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('timer_off', 'later_on')),
      run_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      done_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS clock_settings (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL,
      start_action TEXT NOT NULL,
      start_offset_min INTEGER NOT NULL,
      end_action TEXT NOT NULL,
      end_offset_min INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      program_key TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      device_ids TEXT NOT NULL DEFAULT '[]',
      start_date TEXT,
      end_date TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (tenant_id, program_key)
    );
    CREATE TABLE IF NOT EXISTS program_runs (
      id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      action TEXT NOT NULL,
      run_at TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      done_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      detail TEXT
    );
  `);
  addDeviceColumn(database, "icon", "icon TEXT");
  addDeviceColumn(database, "frozen", "frozen INTEGER NOT NULL DEFAULT 0");
  ensureAccessTables(database);
}

function ensureAccessTables(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS caller_numbers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      phone TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS caller_numbers_tenant_idx ON caller_numbers (tenant_id);
    CREATE TABLE IF NOT EXISTS user_devices (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, device_id)
    );
  `);
  const rows = database
    .prepare("SELECT id, phone, created_at FROM tenants WHERE phone IS NOT NULL AND trim(phone) != ''")
    .all() as Row[];
  const insert = database.prepare(
    "INSERT OR IGNORE INTO caller_numbers (id, tenant_id, phone, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(`ph_${text(row, "id")}`, text(row, "id"), text(row, "phone"), text(row, "created_at") || new Date().toISOString());
  }
}

function seed(database: DatabaseSync) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM users").get() as Row | undefined;
  if (count && Number(count.count) > 0) return;
  const now = new Date().toISOString();
  const insertTenant = database.prepare(
    "INSERT INTO tenants (id, name, phone, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertUser = database.prepare(
    "INSERT INTO users (id, tenant_id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDevice = database.prepare(
    "INSERT INTO devices (device_id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertState = database.prepare(
    `INSERT INTO device_state (
      device_id, connectivity, relay_on, state_updated_at, device_type, api_name, sensor_summary, last_error, updated_at
    ) VALUES (?, ?, ?, ?, 'SC1_T', ?, ?, NULL, ?)`,
  );

  insertTenant.run("ten_yeshiva", "ישיבת הדגמה", "035551001", now);
  insertTenant.run("ten_shul", "בית כנסת הדגמה", "035551002", now);
  insertUser.run("usr_admin", null, "admin", "מנהל המערכת", hashPassword("pikud-admin"), "admin", now);
  insertUser.run("usr_yeshiva", "ten_yeshiva", "yeshiva", "אחראי הישיבה", hashPassword("yeshiva-1"), "operator", now);
  insertUser.run("usr_shul", "ten_shul", "shul", "גבאי", hashPassword("shul-2"), "operator", now);

  const devices = [
    ["rct063285302", "ten_yeshiva", "שקע אולם", "ONLINE", 0],
    ["rct063285417", "ten_yeshiva", "שקע מזגן", "OFFLINE", 0],
    ["rct074190118", "ten_shul", "שקע תאורה", "ONLINE", 1],
  ] as const;
  for (const [deviceId, tenantId, name, connectivity, relayOn] of devices) {
    insertDevice.run(deviceId, tenantId, name, now);
    insertState.run(deviceId, connectivity, relayOn, now, name, "טמפרטורה: לא מחובר", now);
  }
}

function deviceSelect() {
  return `
    SELECT d.device_id, d.name, d.icon, d.frozen, d.vendor, d.kind, d.external_id, d.channel, d.tenant_id,
      t.name AS tenant_name, t.phone AS tenant_phone,
      s.connectivity, s.relay_on, s.state_updated_at, s.device_type, s.sensor_summary, s.last_error
    FROM devices d
    JOIN tenants t ON t.id = d.tenant_id
    LEFT JOIN device_state s ON s.device_id = d.device_id
  `;
}

function vendorOf(row: Row): DeviceView["vendor"] {
  return text(row, "vendor") === "shelly" ? "shelly" : "wlte";
}

function kindOf(row: Row): DeviceView["kind"] {
  return text(row, "kind") === "panel" ? "panel" : "socket";
}

function mapDevice(row: Row): DeviceView & { phone: string | null } {
  const connectivity = text(row, "connectivity");
  const channelRaw = row.channel;
  const channel = channelRaw == null || channelRaw === "" ? null : Number(channelRaw);
  return {
    deviceId: text(row, "device_id"),
    name: text(row, "name"),
    tenantId: text(row, "tenant_id"),
    tenantName: text(row, "tenant_name"),
    phone: textOrNull(row, "tenant_phone"),
    connectivity: connectivity === "ONLINE" || connectivity === "OFFLINE" ? connectivity : "UNKNOWN",
    relayOn: relayValue(row.relay_on),
    stateUpdatedAt: textOrNull(row, "state_updated_at"),
    deviceType: textOrNull(row, "device_type"),
    sensorSummary: textOrNull(row, "sensor_summary"),
    lastError: textOrNull(row, "last_error"),
    icon: textOrNull(row, "icon"),
    frozen: Number(row.frozen) === 1,
    vendor: vendorOf(row),
    kind: kindOf(row),
    externalId: textOrNull(row, "external_id"),
    channel: Number.isInteger(channel) ? channel : null,
  };
}

export function presentDevice(device: DeviceView & { phone?: string | null }): DeviceView {
  return {
    deviceId: device.deviceId,
    name: device.name,
    tenantId: device.tenantId,
    tenantName: device.tenantName,
    connectivity: device.connectivity,
    relayOn: device.relayOn,
    stateUpdatedAt: device.stateUpdatedAt,
    deviceType: device.deviceType,
    sensorSummary: device.sensorSummary,
    lastError: device.lastError,
    icon: device.icon ?? null,
    frozen: device.frozen === true,
    vendor: device.vendor === "shelly" ? "shelly" : "wlte",
    kind: device.kind === "panel" ? "panel" : "socket",
    externalId: device.externalId ?? null,
    channel: device.channel ?? null,
    ...(device.next === undefined ? {} : { next: device.next }),
  };
}

export function setDeviceFrozen(deviceId: string, frozen: boolean): DeviceView | null {
  if (!getDevice(deviceId)) return null;
  db().prepare("UPDATE devices SET frozen = ? WHERE device_id = ?").run(frozen ? 1 : 0, deviceId);
  const view = getDevice(deviceId);
  return view ? presentDevice(view) : null;
}

export function grantsFor(userId: string): string[] | null {
  const rows = db().prepare("SELECT device_id FROM user_devices WHERE user_id = ? ORDER BY device_id").all(userId) as Row[];
  if (!rows.length) return null;
  return rows.map((row) => text(row, "device_id"));
}

export function listDevices(user: { id?: string; role: Role; tenantId: string | null }): DeviceView[] {
  const rows =
    user.role === "admin"
      ? (db().prepare(`${deviceSelect()} ORDER BY t.name, d.name`).all() as Row[])
      : (db().prepare(`${deviceSelect()} WHERE d.tenant_id = ? ORDER BY d.name`).all(user.tenantId) as Row[]);
  const views = rows.map((row) => presentDevice(mapDevice(row)));
  if (user.role === "admin" || !user.id) return views;
  const granted = grantsFor(user.id);
  if (!granted) return views;
  return views.filter((device) => granted.includes(device.deviceId));
}

export function listIvrTargets(): Array<DeviceView & { phone: string | null; phones: string[] }> {
  const phones = callerNumbersByTenant();
  return (db().prepare(`${deviceSelect()} ORDER BY d.name`).all() as Row[]).map((row) => {
    const device = mapDevice(row);
    const listed = phones.get(device.tenantId)?.map((item) => item.phone) ?? [];
    const all = listed.length ? listed : device.phone ? [device.phone] : [];
    return { ...device, phone: all[0] ?? null, phones: all };
  });
}

export function getDevice(deviceId: string): (DeviceView & { phone: string | null }) | null {
  const row = db().prepare(`${deviceSelect()} WHERE d.device_id = ?`).get(deviceId) as Row | undefined;
  return row ? mapDevice(row) : null;
}

export function listDeviceIds(): string[] {
  return (db().prepare("SELECT device_id FROM devices").all() as Row[]).map((row) => text(row, "device_id"));
}

export type StatePatch = {
  connectivity?: Connectivity;
  relayOn?: boolean | null;
  stateUpdatedAt?: string | null;
  deviceType?: string | null;
  sensorSummary?: string | null;
  lastError?: string | null;
};

export function updateDeviceState(
  deviceId: string,
  patch: StatePatch,
  options?: { onlyIfNewer?: boolean },
): DeviceView | null {
  const current = getDevice(deviceId);
  if (!current) return null;
  if (
    options?.onlyIfNewer &&
    patch.stateUpdatedAt &&
    !isNewerIso(current.stateUpdatedAt, patch.stateUpdatedAt)
  ) {
    return presentDevice(current);
  }

  const next = {
    connectivity: patch.connectivity ?? current.connectivity,
    relayOn: patch.relayOn === undefined ? current.relayOn : patch.relayOn,
    stateUpdatedAt: patch.stateUpdatedAt === undefined ? current.stateUpdatedAt : patch.stateUpdatedAt,
    deviceType: patch.deviceType === undefined ? current.deviceType : patch.deviceType,
    sensorSummary: patch.sensorSummary === undefined ? current.sensorSummary : patch.sensorSummary,
    lastError: patch.lastError === undefined ? current.lastError : patch.lastError,
  };
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO device_state (
        device_id, connectivity, relay_on, state_updated_at, device_type, api_name, sensor_summary, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        connectivity = excluded.connectivity,
        relay_on = excluded.relay_on,
        state_updated_at = excluded.state_updated_at,
        device_type = excluded.device_type,
        sensor_summary = excluded.sensor_summary,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at`,
    )
    .run(
      deviceId,
      next.connectivity,
      next.relayOn === null ? null : next.relayOn ? 1 : 0,
      next.stateUpdatedAt,
      next.deviceType,
      next.sensorSummary,
      next.lastError,
      now,
    );
  const view = getDevice(deviceId);
  return view ? presentDevice(view) : null;
}

function callerNumbersByTenant(): Map<string, CallerNumber[]> {
  const rows = db()
    .prepare("SELECT id, tenant_id, phone FROM caller_numbers ORDER BY created_at, id")
    .all() as Row[];
  const map = new Map<string, CallerNumber[]>();
  for (const row of rows) {
    const tenantId = text(row, "tenant_id");
    const list = map.get(tenantId) ?? [];
    list.push({ id: text(row, "id"), phone: text(row, "phone") });
    map.set(tenantId, list);
  }
  return map;
}

function syncTenantPhone(tenantId: string) {
  const first = db()
    .prepare("SELECT phone FROM caller_numbers WHERE tenant_id = ? ORDER BY created_at, id LIMIT 1")
    .get(tenantId) as Row | undefined;
  db().prepare("UPDATE tenants SET phone = ? WHERE id = ?").run(first ? text(first, "phone") : null, tenantId);
}

export function listCallerNumbers(tenantId: string): CallerNumber[] {
  return callerNumbersByTenant().get(tenantId) ?? [];
}

export function addCallerNumber(tenantId: string, phone: string): CallerNumber {
  if (!db().prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId)) throw new HttpError(404, "הלקוח לא נמצא");
  const taken = db().prepare("SELECT tenant_id FROM caller_numbers WHERE phone = ?").get(phone) as Row | undefined;
  if (taken && text(taken, "tenant_id") === tenantId) throw new HttpError(409, "המספר כבר ברשימה");
  if (taken) throw new HttpError(409, "המספר כבר משויך ללקוח אחר");
  const id = `ph_${randomUUID().slice(0, 8)}`;
  db()
    .prepare("INSERT INTO caller_numbers (id, tenant_id, phone, created_at) VALUES (?, ?, ?, ?)")
    .run(id, tenantId, phone, new Date().toISOString());
  syncTenantPhone(tenantId);
  return { id, phone };
}

export function removeCallerNumber(tenantId: string, id: string) {
  const row = db().prepare("SELECT tenant_id FROM caller_numbers WHERE id = ?").get(id) as Row | undefined;
  if (!row || text(row, "tenant_id") !== tenantId) throw new HttpError(404, "המספר לא נמצא");
  db().prepare("DELETE FROM caller_numbers WHERE id = ?").run(id);
  syncTenantPhone(tenantId);
}

export function listTenants(): TenantView[] {
  const phones = callerNumbersByTenant();
  const rows = db()
    .prepare(
      `SELECT t.id, t.name, t.phone,
        (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = t.id) AS device_count,
        (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count
      FROM tenants t
      ORDER BY t.name`,
    )
    .all() as Row[];
  return rows.map((row) => {
    const id = text(row, "id");
    const phone = textOrNull(row, "phone");
    const listed = phones.get(id) ?? [];
    return {
      id,
      name: text(row, "name"),
      phone: listed[0]?.phone ?? phone,
      phones: listed.length ? listed : phone ? [{ id: `ph_${id}`, phone }] : [],
      deviceCount: Number(row.device_count ?? 0),
      userCount: Number(row.user_count ?? 0),
    };
  });
}

export function createTenant(input: { name: string; phone: string | null }): TenantView {
  const id = `ten_${randomUUID().slice(0, 8)}`;
  db()
    .prepare("INSERT INTO tenants (id, name, phone, created_at) VALUES (?, ?, ?, ?)")
    .run(id, input.name, input.phone, new Date().toISOString());
  if (input.phone) addCallerNumber(id, input.phone);
  return listTenants().find((tenant) => tenant.id === id)!;
}

export function renameTenant(id: string, name: string) {
  const result = db().prepare("UPDATE tenants SET name = ? WHERE id = ?").run(name, id);
  if (Number(result.changes) === 0) throw new HttpError(404, "הלקוח לא נמצא");
}

export function createCustomer(input: { name: string; username: string; password: string; phone: string | null }) {
  const tenant = createTenant({ name: input.name, phone: input.phone });
  try {
    createUser({
      username: input.username,
      name: input.name,
      password: input.password,
      role: "operator",
      tenantId: tenant.id,
    });
  } catch (error) {
    deleteTenant(tenant.id);
    throw error;
  }
  return tenant;
}

export function deleteTenant(id: string) {
  const tenant = listTenants().find((item) => item.id === id);
  if (!tenant) throw new HttpError(404, "הלקוח לא נמצא");
  if (tenant.deviceCount > 0 || tenant.userCount > 0) {
    throw new HttpError(409, "אי אפשר למחוק לקוח שעדיין יש לו שקעים או משתמשים");
  }
  db().prepare("DELETE FROM tenants WHERE id = ?").run(id);
}

function grantsByUser(): Map<string, string[]> {
  const rows = db().prepare("SELECT user_id, device_id FROM user_devices ORDER BY device_id").all() as Row[];
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const userId = text(row, "user_id");
    const list = map.get(userId) ?? [];
    list.push(text(row, "device_id"));
    map.set(userId, list);
  }
  return map;
}

export function listUsers(): UserView[] {
  const grants = grantsByUser();
  const rows = db()
    .prepare(
      `SELECT u.id, u.username, u.name, u.role, u.tenant_id, t.name AS tenant_name
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       ORDER BY u.role, u.name`,
    )
    .all() as Row[];
  return rows.map((row) => {
    const user = mapUser(row);
    return { ...user, deviceIds: grants.has(user.id) ? (grants.get(user.id) ?? []) : null };
  });
}

function mapUser(row: Row): UserView {
  const role = text(row, "role");
  return {
    id: text(row, "id"),
    username: text(row, "username"),
    name: text(row, "name"),
    role: role === "admin" ? "admin" : "operator",
    tenantId: textOrNull(row, "tenant_id"),
    tenantName: textOrNull(row, "tenant_name"),
    deviceIds: null,
  };
}

export function createUser(input: {
  username: string;
  name: string;
  password: string;
  role: Role;
  tenantId: string | null;
}) {
  const existing = db().prepare("SELECT id FROM users WHERE username = ?").get(input.username);
  if (existing) throw new HttpError(409, "שם המשתמש כבר תפוס");
  if (input.role === "operator" && !input.tenantId) throw new HttpError(400, "משתמש לקוח חייב להיות משויך ללקוח");
  if (input.tenantId && !listTenants().some((tenant) => tenant.id === input.tenantId)) {
    throw new HttpError(404, "הלקוח לא נמצא");
  }
  db()
    .prepare(
      "INSERT INTO users (id, tenant_id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      `usr_${randomUUID().slice(0, 8)}`,
      input.role === "admin" ? null : input.tenantId,
      input.username,
      input.name,
      hashPassword(input.password),
      input.role,
      new Date().toISOString(),
    );
}

export function deleteUser(id: string, actorId: string) {
  if (id === actorId) throw new HttpError(409, "אי אפשר למחוק את המשתמש שמחובר כרגע");
  const result = db().prepare("DELETE FROM users WHERE id = ?").run(id);
  if (Number(result.changes) === 0) throw new HttpError(404, "המשתמש לא נמצא");
}

export function updateUser(input: {
  id: string;
  actorId: string;
  name: string;
  role: Role;
  tenantId: string | null;
  password: string | null;
  deviceIds: string[] | null;
}) {
  const current = listUsers().find((user) => user.id === input.id);
  if (!current) throw new HttpError(404, "המשתמש לא נמצא");
  if (input.id === input.actorId && input.role !== "admin") {
    throw new HttpError(409, "אי אפשר להסיר את הרשאת המנהל מהמשתמש המחובר");
  }
  if (current.role === "admin" && input.role !== "admin") {
    const admins = listUsers().filter((user) => user.role === "admin").length;
    if (admins <= 1) throw new HttpError(409, "חייבים להישאר לפחות מנהל אחד");
  }
  const tenantId = input.role === "admin" ? null : input.tenantId;
  if (input.role === "operator" && !tenantId) throw new HttpError(400, "משתמש לקוח חייב להיות משויך ללקוח");
  if (tenantId && !db().prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId)) {
    throw new HttpError(404, "הלקוח לא נמצא");
  }
  const deviceIds = input.role === "admin" ? null : input.deviceIds;
  if (deviceIds) {
    if (!deviceIds.length) throw new HttpError(400, "בחרו לפחות שקע אחד, או השאירו את כל השקעים");
    const owned = new Set(
      (db().prepare("SELECT device_id FROM devices WHERE tenant_id = ?").all(tenantId) as Row[]).map((row) => text(row, "device_id")),
    );
    if (deviceIds.some((id) => !owned.has(id))) throw new HttpError(400, "אפשר לשייך רק שקעים של הלקוח");
  }
  if (input.password) {
    db()
      .prepare("UPDATE users SET name = ?, role = ?, tenant_id = ?, password_hash = ? WHERE id = ?")
      .run(input.name, input.role, tenantId, hashPassword(input.password), input.id);
    if (input.id !== input.actorId) db().prepare("DELETE FROM sessions WHERE user_id = ?").run(input.id);
  } else {
    db().prepare("UPDATE users SET name = ?, role = ?, tenant_id = ? WHERE id = ?").run(input.name, input.role, tenantId, input.id);
  }
  db().prepare("DELETE FROM user_devices WHERE user_id = ?").run(input.id);
  if (deviceIds) {
    const insert = db().prepare("INSERT INTO user_devices (user_id, device_id) VALUES (?, ?)");
    for (const deviceId of [...new Set(deviceIds)]) insert.run(input.id, deviceId);
  }
}

export function createDevice(input: {
  deviceId: string;
  name: string;
  tenantId: string;
  vendor?: DeviceView["vendor"];
  kind?: DeviceView["kind"];
  externalId?: string | null;
  channel?: number | null;
  icon?: string | null;
  deviceType?: string | null;
}) {
  if (!listTenants().some((tenant) => tenant.id === input.tenantId)) throw new HttpError(404, "הלקוח לא נמצא");
  if (getDevice(input.deviceId)) throw new HttpError(409, "השקע כבר רשום במערכת");
  const now = new Date().toISOString();
  const vendor = input.vendor === "shelly" ? "shelly" : "wlte";
  const kind = input.kind === "panel" ? "panel" : "socket";
  db()
    .prepare(
      `INSERT INTO devices (
        device_id, tenant_id, name, icon, vendor, kind, external_id, channel, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.deviceId,
      input.tenantId,
      input.name,
      input.icon ?? null,
      vendor,
      kind,
      input.externalId ?? null,
      input.channel ?? null,
      now,
    );
  db()
    .prepare(
      `INSERT INTO device_state (
        device_id, connectivity, relay_on, state_updated_at, device_type, api_name, sensor_summary, last_error, updated_at
      ) VALUES (?, 'UNKNOWN', NULL, NULL, ?, NULL, NULL, NULL, ?)`,
    )
    .run(input.deviceId, input.deviceType ?? null, now);
}

export function createShellyPro3(input: {
  shellyId: string;
  tenantId: string;
  kind: DeviceView["kind"];
  channels: [string, string, string];
}) {
  const shellyId = input.shellyId.trim().toLowerCase();
  const existing = listDevicesByExternalId(shellyId);
  if (existing.length) throw new HttpError(409, "התקן Shelly הזה כבר משויך במערכת");
  const icon = input.kind === "panel" ? "panel" : "socket";
  const created: string[] = [];
  for (const channel of [0, 1, 2] as const) {
    const deviceId = `${shellyId}_ch${channel}`;
    createDevice({
      deviceId,
      name: input.channels[channel],
      tenantId: input.tenantId,
      vendor: "shelly",
      kind: input.kind,
      externalId: shellyId,
      channel,
      icon,
      deviceType: "ShellyPro3",
    });
    created.push(deviceId);
  }
  return created;
}

export function listDevicesByExternalId(externalId: string): DeviceView[] {
  const id = externalId.trim().toLowerCase();
  return (db().prepare(`${deviceSelect()} WHERE lower(d.external_id) = ? ORDER BY d.channel, d.name`).all(id) as Row[]).map((row) =>
    presentDevice(mapDevice(row)),
  );
}

export function updateDevice(input: { deviceId: string; name: string; tenantId: string }) {
  if (!getDevice(input.deviceId)) throw new HttpError(404, "השקע לא נמצא");
  if (!listTenants().some((tenant) => tenant.id === input.tenantId)) throw new HttpError(404, "הלקוח לא נמצא");
  db().prepare("UPDATE devices SET name = ?, tenant_id = ? WHERE device_id = ?").run(
    input.name,
    input.tenantId,
    input.deviceId,
  );
}

export function deleteDevice(deviceId: string) {
  const current = getDevice(deviceId);
  if (!current) throw new HttpError(404, "השקע לא נמצא");
  // Removing one Shelly channel removes the whole Pro 3 unit (all three channels).
  if (current.vendor === "shelly" && current.externalId) {
    const siblings = listDevicesByExternalId(current.externalId);
    const remove = db().prepare("DELETE FROM devices WHERE device_id = ?");
    for (const sibling of siblings) remove.run(sibling.deviceId);
    return siblings.map((sibling) => sibling.deviceId);
  }
  const result = db().prepare("DELETE FROM devices WHERE device_id = ?").run(deviceId);
  if (Number(result.changes) === 0) throw new HttpError(404, "השקע לא נמצא");
  return [deviceId];
}

export function changeOwnPassword(userId: string, currentPassword: string, nextPassword: string) {
  const row = db().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as Row | undefined;
  if (!row) throw new HttpError(404, "המשתמש לא נמצא");
  if (!verifyPassword(currentPassword, text(row, "password_hash"))) throw new HttpError(400, "הסיסמה הנוכחית שגויה");
  if (currentPassword === nextPassword) throw new HttpError(400, "בחרו סיסמה שונה מהנוכחית");
  db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(nextPassword), userId);
}

export function findUserForLogin(username: string): (UserView & { passwordHash: string }) | null {
  const row = db()
    .prepare(
      `SELECT u.id, u.username, u.name, u.role, u.tenant_id, u.password_hash, t.name AS tenant_name
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.username = ?`,
    )
    .get(username) as Row | undefined;
  if (!row) return null;
  return { ...mapUser(row), passwordHash: text(row, "password_hash") };
}

export function createSession(userId: string): { id: string; maxAge: number } {
  const id = randomBytes(32).toString("hex");
  const maxAge = 12 * 60 * 60;
  const now = new Date();
  const expires = new Date(now.getTime() + maxAge * 1000).toISOString();
  db()
    .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, expires, now.toISOString());
  return { id, maxAge };
}

export function readSession(id: string): SessionUser | null {
  const row = db()
    .prepare(
      `SELECT u.id, u.username, u.name, u.role, u.tenant_id, t.name AS tenant_name, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE s.id = ?`,
    )
    .get(id) as Row | undefined;
  if (!row) return null;
  if (Date.parse(text(row, "expires_at")) < Date.now()) {
    db().prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  return mapUser(row);
}

export function deleteSession(id: string) {
  db().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function addAudit(entry: {
  source: AuditSource;
  actor: string;
  deviceId: string | null;
  action: string;
  idempotencyKey: string | null;
  result: string;
  detail: string | null;
}) {
  const database = db();
  database
    .prepare(
      `INSERT INTO audit_log (id, at, source, actor, device_id, action, idempotency_key, result, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      entry.source,
      entry.actor,
      entry.deviceId,
      entry.action,
      entry.idempotencyKey,
      entry.result,
      entry.detail,
    );
  database
    .prepare(
      `DELETE FROM audit_log WHERE id NOT IN (
        SELECT id FROM audit_log ORDER BY at DESC LIMIT 500
      )`,
    )
    .run();
}

export function listAudit(user: { role: Role; tenantId: string | null }, limit = 100): AuditView[] {
  const rows =
    user.role === "admin"
      ? (db()
          .prepare(
            `SELECT a.*, d.name AS device_name
             FROM audit_log a
             LEFT JOIN devices d ON d.device_id = a.device_id
             ORDER BY a.at DESC
             LIMIT ?`,
          )
          .all(limit) as Row[])
      : (db()
          .prepare(
            `SELECT a.*, d.name AS device_name
             FROM audit_log a
             JOIN devices d ON d.device_id = a.device_id
             WHERE d.tenant_id = ?
             ORDER BY a.at DESC
             LIMIT ?`,
          )
          .all(user.tenantId, limit) as Row[]);
  return rows.map((row) => ({
    id: text(row, "id"),
    at: text(row, "at"),
    source: text(row, "source") as AuditSource,
    actor: text(row, "actor"),
    deviceId: textOrNull(row, "device_id"),
    deviceName: textOrNull(row, "device_name"),
    action: text(row, "action"),
    idempotencyKey: textOrNull(row, "idempotency_key"),
    result: text(row, "result"),
    detail: textOrNull(row, "detail"),
  }));
}

function mapSchedule(row: Row): PendingSchedule {
  const kind = text(row, "kind");
  return {
    id: text(row, "id"),
    deviceId: text(row, "device_id"),
    kind: kind === "later_on" ? "later_on" : "timer_off",
    runAt: text(row, "run_at"),
    attempts: Number(row.attempts ?? 0),
  };
}

export function setDeviceIcon(deviceId: string, icon: string): DeviceView | null {
  const result = db().prepare("UPDATE devices SET icon = ? WHERE device_id = ?").run(icon, deviceId);
  if (Number(result.changes) === 0) return null;
  const view = getDevice(deviceId);
  return view ? presentDevice(view) : null;
}

export function listUpcoming(nowIso: string, untilIso: string): Array<{ deviceId: string; at: string; action: "ON" | "OFF" }> {
  const database = db();
  const schedules = database
    .prepare(
      `SELECT device_id, kind, run_at
       FROM schedules
       WHERE done_at IS NULL AND attempts < 8 AND run_at >= ? AND run_at <= ?
       ORDER BY run_at`,
    )
    .all(nowIso, untilIso) as Row[];
  const runs = database
    .prepare(
      `SELECT device_id, action, run_at
       FROM program_runs
       WHERE done_at IS NULL AND attempts < 8 AND run_at >= ? AND run_at <= ?
       ORDER BY run_at`,
    )
    .all(nowIso, untilIso) as Row[];
  return [
    ...schedules.map((row) => ({
      deviceId: text(row, "device_id"),
      at: text(row, "run_at"),
      action: text(row, "kind") === "later_on" ? ("ON" as const) : ("OFF" as const),
    })),
    ...runs.map((row) => ({
      deviceId: text(row, "device_id"),
      at: text(row, "run_at"),
      action: text(row, "action") === "OFF" ? ("OFF" as const) : ("ON" as const),
    })),
  ];
}

export function saveSchedule(input: { deviceId: string; kind: ScheduleKind; runAt: string }) {
  const now = new Date().toISOString();
  const database = db();
  database.prepare("DELETE FROM schedules WHERE device_id = ? AND kind = ? AND done_at IS NULL").run(input.deviceId, input.kind);
  database.prepare(
    "INSERT INTO schedules (id, device_id, kind, run_at, created_at, done_at, attempts, detail) VALUES (?, ?, ?, ?, ?, NULL, 0, NULL)",
  ).run(`sch_${randomUUID()}`, input.deviceId, input.kind, input.runAt, now);
}

export function listDueSchedules(now = new Date().toISOString()): PendingSchedule[] {
  const rows = db()
    .prepare(
      `SELECT id, device_id, kind, run_at, attempts
       FROM schedules
       WHERE done_at IS NULL AND attempts < 8 AND run_at <= ?
       ORDER BY run_at
       LIMIT 20`,
    )
    .all(now) as Row[];
  return rows.map(mapSchedule);
}

export function finishSchedule(id: string) {
  db().prepare("UPDATE schedules SET done_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function failSchedule(id: string, detail: string) {
  const now = new Date().toISOString();
  db()
    .prepare(
      `UPDATE schedules
       SET attempts = attempts + 1,
           detail = ?,
           done_at = CASE WHEN attempts + 1 >= 8 THEN ? ELSE done_at END
       WHERE id = ?`,
    )
    .run(detail.slice(0, 300), now, id);
}

export function listTenantDevices(tenantId: string): DeviceView[] {
  return (db().prepare(`${deviceSelect()} WHERE d.tenant_id = ? ORDER BY d.name`).all(tenantId) as Row[]).map((row) =>
    presentDevice(mapDevice(row)),
  );
}

export function getClock(tenantId: string): ClockSettings {
  const row = db().prepare("SELECT * FROM clock_settings WHERE tenant_id = ?").get(tenantId) as Row | undefined;
  if (!row) return { ...DEFAULT_CLOCK };
  return {
    locationId: text(row, "location_id"),
    startAction: text(row, "start_action") === "OFF" ? "OFF" : "ON",
    startOffsetMin: Number(row.start_offset_min ?? 0),
    endAction: text(row, "end_action") === "ON" ? "ON" : "OFF",
    endOffsetMin: Number(row.end_offset_min ?? 0),
  };
}

export function saveClock(tenantId: string, settings: ClockSettings) {
  db()
    .prepare(
      `INSERT INTO clock_settings (
        tenant_id, location_id, start_action, start_offset_min, end_action, end_offset_min, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        location_id = excluded.location_id,
        start_action = excluded.start_action,
        start_offset_min = excluded.start_offset_min,
        end_action = excluded.end_action,
        end_offset_min = excluded.end_offset_min,
        updated_at = excluded.updated_at`,
    )
    .run(
      tenantId,
      settings.locationId,
      settings.startAction,
      settings.startOffsetMin,
      settings.endAction,
      settings.endOffsetMin,
      new Date().toISOString(),
    );
}

function jsonList(row: Row, key: string): string[] {
  try {
    const parsed = JSON.parse(text(row, key) || "[]") as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
  return [];
}

function jsonWeekdays(row: Row): number[] {
  try {
    const parsed = JSON.parse(text(row, "weekdays") || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  } catch {
    return [];
  }
}

function mapProgram(row: Row): StoredProgram {
  return {
    id: text(row, "id"),
    tenantId: text(row, "tenant_id"),
    programKey: text(row, "program_key"),
    name: text(row, "name"),
    enabled: Number(row.enabled) === 1,
    deviceIds: jsonList(row, "device_ids"),
    startDate: textOrNull(row, "start_date"),
    endDate: textOrNull(row, "end_date"),
    days: jsonList(row, "days"),
    weekdays: jsonWeekdays(row),
    onTime: textOrNull(row, "on_time"),
    offTime: textOrNull(row, "off_time"),
    slots: parseSlots(row.slots, textOrNull(row, "on_time"), textOrNull(row, "off_time")),
    skippedDates: jsonList(row, "skipped_dates").filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
  };
}

export function listPrograms(tenantId: string): StoredProgram[] {
  return (db().prepare("SELECT * FROM programs WHERE tenant_id = ? ORDER BY created_at").all(tenantId) as Row[]).map(mapProgram);
}

export function upsertProgram(program: StoredProgram) {
  db()
    .prepare(
      `INSERT INTO programs (
        id, tenant_id, program_key, name, enabled, device_ids, start_date, end_date, days, weekdays, on_time, off_time, slots, skipped_dates, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, program_key) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        device_ids = excluded.device_ids,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        days = excluded.days,
        weekdays = excluded.weekdays,
        on_time = excluded.on_time,
        off_time = excluded.off_time,
        slots = excluded.slots,
        skipped_dates = excluded.skipped_dates`,
    )
    .run(
      program.id,
      program.tenantId,
      program.programKey,
      program.name,
      program.enabled ? 1 : 0,
      JSON.stringify(program.deviceIds),
      program.startDate,
      program.endDate,
      JSON.stringify(program.days ?? []),
      JSON.stringify(program.weekdays ?? []),
      program.onTime,
      program.offTime,
      JSON.stringify(program.slots ?? []),
      JSON.stringify(program.skippedDates ?? []),
      new Date().toISOString(),
    );
}

export function deleteProgram(tenantId: string, id: string) {
  const database = db();
  database.prepare("DELETE FROM clocks WHERE program_id = ?").run(id);
  database.prepare("DELETE FROM program_runs WHERE program_id = ?").run(id);
  const result = database.prepare("DELETE FROM programs WHERE tenant_id = ? AND id = ?").run(tenantId, id);
  if (Number(result.changes) === 0) throw new HttpError(404, "התוכנית לא נמצאה");
}

function mapClock(row: Row): DayClock {
  return {
    id: text(row, "id"),
    tenantId: text(row, "tenant_id"),
    programId: textOrNull(row, "program_id"),
    day: text(row, "day"),
    onTime: textOrNull(row, "on_time"),
    offTime: textOrNull(row, "off_time"),
    deviceIds: jsonList(row, "device_ids"),
  };
}

export function listDayClocks(tenantId: string): DayClock[] {
  return (
    db().prepare("SELECT * FROM clocks WHERE tenant_id = ? ORDER BY day, on_time, off_time").all(tenantId) as Row[]
  ).map(mapClock);
}

export function saveDayClock(clock: DayClock) {
  const database = db();
  const existing = database.prepare("SELECT tenant_id FROM clocks WHERE id = ?").get(clock.id) as Row | undefined;
  if (existing && text(existing, "tenant_id") !== clock.tenantId) throw new HttpError(404, "השעון לא נמצא");
  database
    .prepare(
      `INSERT INTO clocks (
        id, tenant_id, program_id, day, on_time, off_time, device_ids, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        program_id = excluded.program_id,
        day = excluded.day,
        on_time = excluded.on_time,
        off_time = excluded.off_time,
        device_ids = excluded.device_ids`,
    )
    .run(
      clock.id,
      clock.tenantId,
      clock.programId,
      clock.day,
      clock.onTime,
      clock.offTime,
      JSON.stringify(clock.deviceIds),
      new Date().toISOString(),
    );
}

export function deleteDayClock(tenantId: string, id: string) {
  const result = db().prepare("DELETE FROM clocks WHERE tenant_id = ? AND id = ?").run(tenantId, id);
  if (Number(result.changes) === 0) throw new HttpError(404, "השעון לא נמצא");
}

export function saveDateProgram(program: StoredProgram, clocks: DayClock[]) {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    upsertProgram(program);
    const existing = listDayClocks(program.tenantId);
    const next = resolveDateClocks(program.id, program.tenantId, clocks, existing);
    const keep = new Set(next.map((clock) => clock.id));
    for (const clock of next) saveDayClock(clock);
    const remove = database.prepare("DELETE FROM clocks WHERE tenant_id = ? AND id = ?");
    for (const clock of existing) {
      if (clock.programId === program.id && !keep.has(clock.id)) remove.run(program.tenantId, clock.id);
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The write error is the one to surface when the rollback itself fails.
    }
    throw error;
  }
}

export function listRunsFor(programId: string): ProgramRun[] {
  const rows = db()
    .prepare(
      `SELECT id, program_id, device_id, action, run_at, label, attempts
       FROM program_runs
       WHERE program_id = ? AND done_at IS NULL
       ORDER BY run_at`,
    )
    .all(programId) as Row[];
  return rows.map(mapRun);
}

export function replaceProgramRuns(programId: string, runs: ProgramRunInput[]) {
  const database = db();
  const now = new Date().toISOString();
  database.prepare("DELETE FROM program_runs WHERE program_id = ? AND done_at IS NULL").run(programId);
  const insert = database.prepare(
    `INSERT INTO program_runs (
      id, program_id, device_id, action, run_at, label, created_at, done_at, attempts, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)`,
  );
  for (const run of runs) {
    insert.run(`run_${randomUUID()}`, programId, run.deviceId, run.action, run.runAt, run.label.slice(0, 180), now);
  }
}

export function listProgramRuns(tenantId: string): ProgramRun[] {
  const rows = db()
    .prepare(
      `SELECT r.* FROM program_runs r
       JOIN programs p ON p.id = r.program_id
       WHERE p.tenant_id = ? AND r.done_at IS NULL
       ORDER BY r.run_at`,
    )
    .all(tenantId) as Row[];
  return rows.map(mapRun);
}

export function listDueProgramRuns(now = new Date().toISOString()): ProgramRun[] {
  const rows = db()
    .prepare(
      `SELECT id, program_id, device_id, action, run_at, label, attempts
       FROM program_runs
       WHERE done_at IS NULL AND attempts < 8 AND run_at <= ?
       ORDER BY run_at
       LIMIT 20`,
    )
    .all(now) as Row[];
  return rows.map(mapRun);
}

export function finishProgramRun(id: string) {
  db().prepare("UPDATE program_runs SET done_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function failProgramRun(id: string, detail: string) {
  const now = new Date().toISOString();
  db()
    .prepare(
      `UPDATE program_runs
       SET attempts = attempts + 1,
           detail = ?,
           done_at = CASE WHEN attempts + 1 >= 8 THEN ? ELSE done_at END
       WHERE id = ?`,
    )
    .run(detail.slice(0, 300), now, id);
}

function mapRun(row: Row): ProgramRun {
  return {
    id: text(row, "id"),
    programId: text(row, "program_id"),
    deviceId: text(row, "device_id"),
    action: text(row, "action") === "OFF" ? "OFF" : "ON",
    runAt: text(row, "run_at"),
    label: text(row, "label"),
    attempts: Number(row.attempts ?? 0),
  };
}
