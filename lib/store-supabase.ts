import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SqlValue } from "node:sqlite";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http-error";
import { hashPassword } from "@/lib/password";
import type { ClockSettings } from "@/lib/hebrew/calendar";
import { DEFAULT_CLOCK } from "@/lib/hebrew/calendar";
import type { DayClock, ProgramRun, ProgramRunInput, StoredProgram } from "@/lib/programs/types";
import type { PendingSchedule, ScheduleKind } from "@/lib/schedules/types";
import { presentDevice, type StatePatch } from "@/lib/store-sqlite";
import type { AuditSource, AuditView, DeviceView, Role, SessionUser, TenantView, UserView } from "@/lib/types";
import { isNewerIso } from "@/lib/wlte/parse";

type DbError = { message: string; code?: string };
type Embed<T> = T | T[] | null;

type DeviceStateRow = {
  connectivity: string | null;
  relay_on: boolean | null;
  state_updated_at: string | null;
  device_type: string | null;
  sensor_summary: string | null;
  last_error: string | null;
};

type DeviceRow = {
  device_id: string;
  name: string;
  tenant_id: string;
  tenants: Embed<{ name: string; phone: string | null }>;
  device_state: Embed<DeviceStateRow>;
};

type UserRow = {
  id: string;
  username: string;
  name: string;
  role: string;
  tenant_id: string | null;
  tenants: Embed<{ name: string }>;
};

const globalRemote = globalThis as unknown as { __pikudSupabase?: SupabaseClient; __pikudSupabaseReady?: Promise<void> };

function client(): SupabaseClient {
  if (!globalRemote.__pikudSupabase) {
    const url = process.env.SUPABASE_URL?.trim() ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
    if (!url || !key) throw new HttpError(500, "חסר SUPABASE_URL או SUPABASE_SERVICE_ROLE_KEY");
    globalRemote.__pikudSupabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return globalRemote.__pikudSupabase;
}

function fail(error: DbError, fallback: string): never {
  if (error.code === "42P01" || error.code === "PGRST205" || /schema cache|does not exist/i.test(error.message)) {
    throw new HttpError(500, "טבלאות סופרבייס חסרות. הריצו את supabase/schema.sql");
  }
  console.error("[pikud] supabase", error.code ?? "", error.message);
  throw new HttpError(500, fallback);
}

function one<T>(value: Embed<T> | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function ready() {
  if (!globalRemote.__pikudSupabaseReady) {
    const pending = prepare().catch((error: unknown) => {
      globalRemote.__pikudSupabaseReady = undefined;
      throw error;
    });
    globalRemote.__pikudSupabaseReady = pending;
  }
  await globalRemote.__pikudSupabaseReady;
}

async function prepare() {
  const count = await client().from("users").select("id", { count: "exact", head: true });
  if (count.error) fail(count.error, "לא ניתן לקרוא משתמשים מסופרבייס");
  if ((count.count ?? 0) > 0) {
    console.info("[pikud] storage=supabase");
    return;
  }
  const sqliteFile = path.join(process.cwd(), ".data", "pikud.sqlite");
  if (fs.existsSync(sqliteFile)) {
    try {
      const copied = await importSqlite();
      if (copied) {
        console.info("[pikud] storage=supabase, copied existing sqlite data");
        return;
      }
    } catch (error) {
      console.error("[pikud] sqlite copy failed", error);
      await wipe();
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "העתקה מ-SQLite לסופרבייס נכשלה");
    }
  }
  await seedAdmin();
  console.info("[pikud] storage=supabase, created admin because the database was empty");
}

async function wipe() {
  const db = client();
  await db.from("audit_log").delete().neq("id", "");
  await db.from("sessions").delete().neq("id", "");
  await db.from("device_state").delete().neq("device_id", "");
  await db.from("devices").delete().neq("device_id", "");
  await db.from("users").delete().neq("id", "");
  await db.from("tenants").delete().neq("id", "");
}

function openSqlite(file: string) {
  try {
    return new DatabaseSync(file, { readOnly: true });
  } catch {
    return new DatabaseSync(file);
  }
}

function cell(row: Record<string, SqlValue>, key: string): string | null {
  const value = row[key];
  if (typeof value === "string") return value;
  if (value == null) return null;
  return String(value);
}

async function importSqlite(): Promise<boolean> {
  const file = path.join(process.cwd(), ".data", "pikud.sqlite");
  if (!fs.existsSync(file)) return false;
  const database = openSqlite(file);
  try {
    const tenants = database.prepare("SELECT id, name, phone, created_at FROM tenants").all() as Array<Record<string, SqlValue>>;
    const users = database.prepare("SELECT id, tenant_id, username, name, password_hash, role, created_at FROM users").all() as Array<
      Record<string, SqlValue>
    >;
    const devices = database.prepare("SELECT device_id, tenant_id, name, created_at FROM devices").all() as Array<Record<string, SqlValue>>;
    const states = database.prepare("SELECT * FROM device_state").all() as Array<Record<string, SqlValue>>;
    const sessions = database.prepare("SELECT id, user_id, expires_at, created_at FROM sessions").all() as Array<Record<string, SqlValue>>;
    const audit = database.prepare("SELECT * FROM audit_log").all() as Array<Record<string, SqlValue>>;
    if (users.length === 0) return false;
    await insert("tenants", tenants.map((row) => ({
      id: cell(row, "id"),
      name: cell(row, "name"),
      phone: cell(row, "phone"),
      created_at: cell(row, "created_at"),
    })));
    await insert("users", users.map((row) => ({
      id: cell(row, "id"),
      tenant_id: cell(row, "tenant_id"),
      username: cell(row, "username"),
      name: cell(row, "name"),
      password_hash: cell(row, "password_hash"),
      role: cell(row, "role"),
      created_at: cell(row, "created_at"),
    })));
    await insert("devices", devices.map((row) => ({
      device_id: cell(row, "device_id"),
      tenant_id: cell(row, "tenant_id"),
      name: cell(row, "name"),
      created_at: cell(row, "created_at"),
    })));
    await insert("device_state", states.map((row) => ({
      device_id: cell(row, "device_id"),
      connectivity: cell(row, "connectivity") ?? "UNKNOWN",
      relay_on: row.relay_on == null ? null : Number(row.relay_on) === 1,
      state_updated_at: cell(row, "state_updated_at"),
      device_type: cell(row, "device_type"),
      api_name: cell(row, "api_name"),
      sensor_summary: cell(row, "sensor_summary"),
      last_error: cell(row, "last_error"),
      updated_at: cell(row, "updated_at"),
    })));
    await insert("sessions", sessions.map((row) => ({
      id: cell(row, "id"),
      user_id: cell(row, "user_id"),
      expires_at: cell(row, "expires_at"),
      created_at: cell(row, "created_at"),
    })));
    await insert("audit_log", audit.map((row) => ({
      id: cell(row, "id"),
      at: cell(row, "at"),
      source: cell(row, "source"),
      actor: cell(row, "actor"),
      device_id: cell(row, "device_id"),
      action: cell(row, "action"),
      idempotency_key: cell(row, "idempotency_key"),
      result: cell(row, "result"),
      detail: cell(row, "detail"),
    })));
    console.info(`[pikud] copied ${users.length} users and ${devices.length} devices into supabase`);
    return true;
  } finally {
    database.close();
  }
}

async function insert(table: "tenants" | "users" | "devices" | "device_state" | "sessions" | "audit_log", rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const result = await client().from(table).insert(rows);
  if (result.error) fail(result.error, "ייבוא מ-SQLite נכשל");
}

async function seedAdmin() {
  const now = new Date().toISOString();
  const result = await client().from("users").insert({
    id: "usr_admin",
    tenant_id: null,
    username: "admin",
    name: "מנהל המערכת",
    password_hash: hashPassword("pikud-admin"),
    role: "admin",
    created_at: now,
  });
  if (result.error) fail(result.error, "יצירת מנהל ראשון נכשלה");
}

function mapDevice(row: DeviceRow): DeviceView & { phone: string | null } {
  const tenant = one(row.tenants);
  const state = one(row.device_state);
  const connectivity = state?.connectivity;
  return {
    deviceId: row.device_id,
    name: row.name,
    tenantId: row.tenant_id,
    tenantName: tenant?.name ?? "",
    phone: tenant?.phone ?? null,
    connectivity: connectivity === "ONLINE" || connectivity === "OFFLINE" ? connectivity : "UNKNOWN",
    relayOn: state?.relay_on ?? null,
    stateUpdatedAt: state?.state_updated_at ?? null,
    deviceType: state?.device_type ?? null,
    sensorSummary: state?.sensor_summary ?? null,
    lastError: state?.last_error ?? null,
  };
}

const deviceColumns =
  "device_id, name, tenant_id, tenants!inner(name, phone), device_state(connectivity, relay_on, state_updated_at, device_type, sensor_summary, last_error)";

async function deviceRows(tenantId?: string | null): Promise<DeviceRow[]> {
  let query = client().from("devices").select(deviceColumns);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const result = await query;
  if (result.error) fail(result.error, "לא ניתן לקרוא שקעים");
  return (result.data ?? []) as unknown as DeviceRow[];
}

function sortDevices(rows: Array<DeviceView & { phone: string | null }>, byTenant: boolean) {
  return rows.sort((left, right) => {
    if (byTenant && left.tenantName !== right.tenantName) return left.tenantName < right.tenantName ? -1 : 1;
    if (left.name === right.name) return 0;
    return left.name < right.name ? -1 : 1;
  });
}

export async function listDevices(user: { role: Role; tenantId: string | null }): Promise<DeviceView[]> {
  await ready();
  if (user.role !== "admin" && !user.tenantId) return [];
  const rows = await deviceRows(user.role === "admin" ? null : user.tenantId);
  return sortDevices(rows.map(mapDevice), user.role === "admin").map(presentDevice);
}

export async function listIvrTargets(): Promise<Array<DeviceView & { phone: string | null }>> {
  await ready();
  return sortDevices((await deviceRows()).map(mapDevice), false);
}

export async function getDevice(deviceId: string): Promise<(DeviceView & { phone: string | null }) | null> {
  await ready();
  const result = await client().from("devices").select(deviceColumns).eq("device_id", deviceId).maybeSingle();
  if (result.error) fail(result.error, "לא ניתן לקרוא שקע");
  return result.data ? mapDevice(result.data as unknown as DeviceRow) : null;
}

export async function listDeviceIds(): Promise<string[]> {
  await ready();
  const result = await client().from("devices").select("device_id");
  if (result.error) fail(result.error, "לא ניתן לקרוא שקעים");
  return (result.data ?? []).map((row) => String(row.device_id));
}

export async function updateDeviceState(
  deviceId: string,
  patch: StatePatch,
  options?: { onlyIfNewer?: boolean },
): Promise<DeviceView | null> {
  await ready();
  const current = await getDevice(deviceId);
  if (!current) return null;
  if (options?.onlyIfNewer && patch.stateUpdatedAt && !isNewerIso(current.stateUpdatedAt, patch.stateUpdatedAt)) {
    return presentDevice(current);
  }
  const next = {
    connectivity: patch.connectivity ?? current.connectivity,
    relay_on: patch.relayOn === undefined ? current.relayOn : patch.relayOn,
    state_updated_at: patch.stateUpdatedAt === undefined ? current.stateUpdatedAt : patch.stateUpdatedAt,
    device_type: patch.deviceType === undefined ? current.deviceType : patch.deviceType,
    sensor_summary: patch.sensorSummary === undefined ? current.sensorSummary : patch.sensorSummary,
    last_error: patch.lastError === undefined ? current.lastError : patch.lastError,
    updated_at: new Date().toISOString(),
  };
  const result = await client().from("device_state").upsert(
    { device_id: deviceId, ...next },
    { onConflict: "device_id" },
  );
  if (result.error) fail(result.error, "עדכון מצב השקע נכשל");
  const view = await getDevice(deviceId);
  return view ? presentDevice(view) : null;
}

function countOf(value: unknown): number {
  if (Array.isArray(value)) return countOf(value[0]);
  if (value && typeof value === "object" && "count" in value) {
    return Number((value as { count?: unknown }).count ?? 0);
  }
  return 0;
}

export async function listTenants(): Promise<TenantView[]> {
  await ready();
  const result = await client().from("tenants").select("id, name, phone, devices(count), users(count)").order("name");
  if (result.error) fail(result.error, "לא ניתן לקרוא לקוחות");
  return (result.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    phone: row.phone == null || row.phone === "" ? null : String(row.phone),
    deviceCount: countOf(row.devices),
    userCount: countOf(row.users),
  }));
}

export async function createTenant(input: { name: string; phone: string | null }): Promise<TenantView> {
  await ready();
  const id = `ten_${randomUUID().slice(0, 8)}`;
  const result = await client().from("tenants").insert({
    id,
    name: input.name,
    phone: input.phone,
    created_at: new Date().toISOString(),
  });
  if (result.error) fail(result.error, "יצירת לקוח נכשלה");
  const tenant = (await listTenants()).find((item) => item.id === id);
  if (!tenant) throw new HttpError(500, "הלקוח נשמר אבל לא נקרא בחזרה");
  return tenant;
}

export async function deleteTenant(id: string) {
  await ready();
  const tenant = (await listTenants()).find((item) => item.id === id);
  if (!tenant) throw new HttpError(404, "הלקוח לא נמצא");
  if (tenant.deviceCount > 0 || tenant.userCount > 0) {
    throw new HttpError(409, "אי אפשר למחוק לקוח שעדיין יש לו שקעים או משתמשים");
  }
  const result = await client().from("tenants").delete().eq("id", id);
  if (result.error) fail(result.error, "מחיקת לקוח נכשלה");
}

function mapUser(row: UserRow): UserView {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role === "admin" ? "admin" : "operator",
    tenantId: row.tenant_id,
    tenantName: one(row.tenants)?.name ?? null,
  };
}

export async function listUsers(): Promise<UserView[]> {
  await ready();
  const result = await client().from("users").select("id, username, name, role, tenant_id, tenants(name)").order("role").order("name");
  if (result.error) fail(result.error, "לא ניתן לקרוא משתמשים");
  return ((result.data ?? []) as unknown as UserRow[]).map(mapUser);
}

export async function createUser(input: {
  username: string;
  name: string;
  password: string;
  role: Role;
  tenantId: string | null;
}) {
  await ready();
  const existing = await client().from("users").select("id").eq("username", input.username).maybeSingle();
  if (existing.error) fail(existing.error, "לא ניתן לבדוק שם משתמש");
  if (existing.data) throw new HttpError(409, "שם המשתמש כבר תפוס");
  if (input.role === "operator" && !input.tenantId) throw new HttpError(400, "משתמש לקוח חייב להיות משויך ללקוח");
  if (input.tenantId && !(await listTenants()).some((tenant) => tenant.id === input.tenantId)) {
    throw new HttpError(404, "הלקוח לא נמצא");
  }
  const result = await client().from("users").insert({
    id: `usr_${randomUUID().slice(0, 8)}`,
    tenant_id: input.role === "admin" ? null : input.tenantId,
    username: input.username,
    name: input.name,
    password_hash: hashPassword(input.password),
    role: input.role,
    created_at: new Date().toISOString(),
  });
  if (result.error?.code === "23505") throw new HttpError(409, "שם המשתמש כבר תפוס");
  if (result.error) fail(result.error, "יצירת משתמש נכשלה");
}

export async function deleteUser(id: string, actorId: string) {
  await ready();
  if (id === actorId) throw new HttpError(409, "אי אפשר למחוק את המשתמש שמחובר כרגע");
  const result = await client().from("users").delete().eq("id", id).select("id");
  if (result.error) fail(result.error, "מחיקת משתמש נכשלה");
  if (!result.data?.length) throw new HttpError(404, "המשתמש לא נמצא");
}

export async function createDevice(input: { deviceId: string; name: string; tenantId: string }) {
  await ready();
  if (!(await listTenants()).some((tenant) => tenant.id === input.tenantId)) throw new HttpError(404, "הלקוח לא נמצא");
  if (await getDevice(input.deviceId)) throw new HttpError(409, "השקע כבר רשום במערכת");
  const now = new Date().toISOString();
  const created = await client().from("devices").insert({
    device_id: input.deviceId,
    tenant_id: input.tenantId,
    name: input.name,
    created_at: now,
  });
  if (created.error?.code === "23505") throw new HttpError(409, "השקע כבר רשום במערכת");
  if (created.error) fail(created.error, "שיוך שקע נכשל");
  const state = await client().from("device_state").insert({
    device_id: input.deviceId,
    connectivity: "UNKNOWN",
    relay_on: null,
    state_updated_at: null,
    device_type: null,
    api_name: null,
    sensor_summary: null,
    last_error: null,
    updated_at: now,
  });
  if (state.error) {
    await client().from("devices").delete().eq("device_id", input.deviceId);
    fail(state.error, "שיוך שקע נכשל");
  }
}

export async function updateDevice(input: { deviceId: string; name: string; tenantId: string }) {
  await ready();
  if (!(await getDevice(input.deviceId))) throw new HttpError(404, "השקע לא נמצא");
  if (!(await listTenants()).some((tenant) => tenant.id === input.tenantId)) throw new HttpError(404, "הלקוח לא נמצא");
  const result = await client().from("devices").update({ name: input.name, tenant_id: input.tenantId }).eq("device_id", input.deviceId);
  if (result.error) fail(result.error, "עדכון שקע נכשל");
}

export async function deleteDevice(deviceId: string) {
  await ready();
  const result = await client().from("devices").delete().eq("device_id", deviceId).select("device_id");
  if (result.error) fail(result.error, "הסרת שקע נכשלה");
  if (!result.data?.length) throw new HttpError(404, "השקע לא נמצא");
}

export async function findUserForLogin(username: string): Promise<(UserView & { passwordHash: string }) | null> {
  await ready();
  const result = await client()
    .from("users")
    .select("id, username, name, role, tenant_id, password_hash, tenants(name)")
    .eq("username", username)
    .maybeSingle();
  if (result.error) fail(result.error, "התחברות נכשלה");
  if (!result.data) return null;
  const row = result.data as unknown as UserRow & { password_hash: string };
  return { ...mapUser(row), passwordHash: row.password_hash };
}

export async function createSession(userId: string): Promise<{ id: string; maxAge: number }> {
  await ready();
  const id = randomBytes(32).toString("hex");
  const maxAge = 12 * 60 * 60;
  const now = new Date();
  const result = await client().from("sessions").insert({
    id,
    user_id: userId,
    expires_at: new Date(now.getTime() + maxAge * 1000).toISOString(),
    created_at: now.toISOString(),
  });
  if (result.error) fail(result.error, "פתיחת סשן נכשלה");
  return { id, maxAge };
}

export async function readSession(id: string): Promise<SessionUser | null> {
  await ready();
  const result = await client()
    .from("sessions")
    .select("expires_at, users!inner(id, username, name, role, tenant_id, tenants(name))")
    .eq("id", id)
    .maybeSingle();
  if (result.error) fail(result.error, "קריאת סשן נכשלה");
  if (!result.data) return null;
  const row = result.data as unknown as { expires_at: string; users: Embed<UserRow> };
  if (Date.parse(row.expires_at) < Date.now()) {
    await client().from("sessions").delete().eq("id", id);
    return null;
  }
  const user = one(row.users);
  return user ? mapUser(user) : null;
}

export async function deleteSession(id: string) {
  await ready();
  const result = await client().from("sessions").delete().eq("id", id);
  if (result.error) fail(result.error, "ניתוק נכשל");
}

export async function addAudit(entry: {
  source: AuditSource;
  actor: string;
  deviceId: string | null;
  action: string;
  idempotencyKey: string | null;
  result: string;
  detail: string | null;
}) {
  await ready();
  const inserted = await client().from("audit_log").insert({
    id: randomUUID(),
    at: new Date().toISOString(),
    source: entry.source,
    actor: entry.actor,
    device_id: entry.deviceId,
    action: entry.action,
    idempotency_key: entry.idempotencyKey,
    result: entry.result,
    detail: entry.detail,
  });
  if (inserted.error) fail(inserted.error, "כתיבת יומן נכשלה");
  const stale = await client().from("audit_log").select("id").order("at", { ascending: false }).range(500, 5000);
  if (stale.error) fail(stale.error, "כתיבת יומן נכשלה");
  const ids = (stale.data ?? []).map((row) => String(row.id));
  if (!ids.length) return;
  const removed = await client().from("audit_log").delete().in("id", ids);
  if (removed.error) fail(removed.error, "כתיבת יומן נכשלה");
}

export async function listAudit(user: { role: Role; tenantId: string | null }, limit = 100): Promise<AuditView[]> {
  await ready();
  let deviceIds: string[] | null = null;
  const names = new Map<string, string>();
  if (user.role !== "admin") {
    if (!user.tenantId) return [];
    const owned = await client().from("devices").select("device_id, name").eq("tenant_id", user.tenantId);
    if (owned.error) fail(owned.error, "לא ניתן לקרוא יומן");
    for (const row of owned.data ?? []) names.set(String(row.device_id), String(row.name));
    deviceIds = [...names.keys()];
    if (!deviceIds.length) return [];
  }
  let query = client().from("audit_log").select("*").order("at", { ascending: false }).limit(limit);
  if (deviceIds) query = query.in("device_id", deviceIds);
  const result = await query;
  if (result.error) fail(result.error, "לא ניתן לקרוא יומן");
  const rows = result.data ?? [];
  if (user.role === "admin") {
    const ids = [...new Set(rows.map((row) => row.device_id).filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (ids.length) {
      const devices = await client().from("devices").select("device_id, name").in("device_id", ids);
      if (devices.error) fail(devices.error, "לא ניתן לקרוא יומן");
      for (const row of devices.data ?? []) names.set(String(row.device_id), String(row.name));
    }
  }
  return rows.map((row) => ({
    id: String(row.id),
    at: String(row.at),
    source: String(row.source) as AuditSource,
    actor: String(row.actor),
    deviceId: row.device_id == null ? null : String(row.device_id),
    deviceName: row.device_id == null ? null : names.get(String(row.device_id)) ?? null,
    action: String(row.action),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    result: String(row.result),
    detail: row.detail == null ? null : String(row.detail),
  }));
}

export async function saveSchedule(input: { deviceId: string; kind: ScheduleKind; runAt: string }) {
  await ready();
  const removed = await client().from("schedules").delete().eq("device_id", input.deviceId).eq("kind", input.kind).is("done_at", null);
  if (removed.error) fail(removed.error, "שמירת הטיימר נכשלה. הריצו את טבלת schedules בסופרבייס");
  const inserted = await client().from("schedules").insert({
    id: `sch_${randomUUID()}`,
    device_id: input.deviceId,
    kind: input.kind,
    run_at: input.runAt,
    created_at: new Date().toISOString(),
    done_at: null,
    attempts: 0,
    detail: null,
  });
  if (inserted.error) fail(inserted.error, "שמירת הטיימר נכשלה. הריצו את טבלת schedules בסופרבייס");
}

export async function listDueSchedules(now = new Date().toISOString()): Promise<PendingSchedule[]> {
  await ready();
  const result = await client()
    .from("schedules")
    .select("id, device_id, kind, run_at, attempts")
    .is("done_at", null)
    .lt("attempts", 8)
    .lte("run_at", now)
    .order("run_at")
    .limit(20);
  if (result.error) fail(result.error, "קריאת טיימרים נכשלה");
  return (result.data ?? []).map((row) => ({
    id: String(row.id),
    deviceId: String(row.device_id),
    kind: row.kind === "later_on" ? "later_on" : "timer_off",
    runAt: String(row.run_at),
    attempts: Number(row.attempts ?? 0),
  }));
}

export async function finishSchedule(id: string) {
  await ready();
  const result = await client().from("schedules").update({ done_at: new Date().toISOString() }).eq("id", id);
  if (result.error) fail(result.error, "עדכון טיימר נכשל");
}

export async function listTenantDevices(tenantId: string): Promise<DeviceView[]> {
  await ready();
  return sortDevices((await deviceRows(tenantId)).map(mapDevice), false).map(presentDevice);
}

export async function getClock(tenantId: string): Promise<ClockSettings> {
  await ready();
  const result = await client().from("clock_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (result.error) fail(result.error, "לא ניתן לקרוא את שעון השבת");
  const row = result.data;
  if (!row) return { ...DEFAULT_CLOCK };
  return {
    locationId: String(row.location_id),
    startAction: row.start_action === "OFF" ? "OFF" : "ON",
    startOffsetMin: Number(row.start_offset_min ?? 0),
    endAction: row.end_action === "ON" ? "ON" : "OFF",
    endOffsetMin: Number(row.end_offset_min ?? 0),
  };
}

export async function saveClock(tenantId: string, settings: ClockSettings) {
  await ready();
  const result = await client().from("clock_settings").upsert(
    {
      tenant_id: tenantId,
      location_id: settings.locationId,
      start_action: settings.startAction,
      start_offset_min: settings.startOffsetMin,
      end_action: settings.endAction,
      end_offset_min: settings.endOffsetMin,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (result.error) fail(result.error, "שמירת שעון השבת נכשלה. הריצו את supabase/schema.sql");
}

function jsonList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value || "[]" : "[]") as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
  return [];
}

function mapProgram(row: {
  id: string;
  tenant_id: string;
  program_key: string;
  name: string;
  enabled: boolean;
  device_ids: string;
  start_date: string | null;
  end_date: string | null;
  days?: string | null;
}): StoredProgram {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    programKey: String(row.program_key),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    deviceIds: jsonList(row.device_ids),
    startDate: row.start_date,
    endDate: row.end_date,
    days: jsonList(row.days),
  };
}

export async function listPrograms(tenantId: string): Promise<StoredProgram[]> {
  await ready();
  const result = await client().from("programs").select("*").eq("tenant_id", tenantId).order("created_at");
  if (result.error) fail(result.error, "לא ניתן לקרוא תוכניות. הריצו את supabase/schema.sql");
  return (result.data ?? []).map((row) => mapProgram(row as never));
}

export async function upsertProgram(program: StoredProgram) {
  await ready();
  const result = await client().from("programs").upsert(
    {
      id: program.id,
      tenant_id: program.tenantId,
      program_key: program.programKey,
      name: program.name,
      enabled: program.enabled,
      device_ids: JSON.stringify(program.deviceIds),
      start_date: program.startDate,
      end_date: program.endDate,
      days: JSON.stringify(program.days ?? []),
      created_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,program_key" },
  );
  if (result.error) fail(result.error, "שמירת התוכנית נכשלה. הריצו את supabase/schema.sql");
}

export async function deleteProgram(tenantId: string, id: string) {
  await ready();
  const clocks = await client().from("clocks").delete().eq("program_id", id);
  if (clocks.error) fail(clocks.error, "מחיקת התוכנית נכשלה");
  const runs = await client().from("program_runs").delete().eq("program_id", id);
  if (runs.error) fail(runs.error, "מחיקת התוכנית נכשלה");
  const result = await client().from("programs").delete().eq("tenant_id", tenantId).eq("id", id).select("id");
  if (result.error) fail(result.error, "מחיקת התוכנית נכשלה");
  if (!result.data?.length) throw new HttpError(404, "התוכנית לא נמצאה");
}

function mapClock(row: {
  id: string;
  tenant_id: string;
  program_id: string | null;
  day: string;
  on_time: string | null;
  off_time: string | null;
  device_ids: string;
}): DayClock {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    programId: row.program_id ? String(row.program_id) : null,
    day: String(row.day),
    onTime: row.on_time,
    offTime: row.off_time,
    deviceIds: jsonList(row.device_ids),
  };
}

export async function listDayClocks(tenantId: string): Promise<DayClock[]> {
  await ready();
  const result = await client().from("clocks").select("*").eq("tenant_id", tenantId).order("day").order("on_time");
  if (result.error) fail(result.error, "לא ניתן לקרוא שעונים. הריצו את supabase/schema.sql");
  return (result.data ?? []).map((row) => mapClock(row as never));
}

export async function saveDayClock(clock: DayClock) {
  await ready();
  const existing = await client().from("clocks").select("tenant_id").eq("id", clock.id).maybeSingle();
  if (existing.error) fail(existing.error, "שמירת השעון נכשלה");
  if (existing.data && String(existing.data.tenant_id) !== clock.tenantId) throw new HttpError(404, "השעון לא נמצא");
  const result = await client().from("clocks").upsert(
    {
      id: clock.id,
      tenant_id: clock.tenantId,
      program_id: clock.programId,
      day: clock.day,
      on_time: clock.onTime,
      off_time: clock.offTime,
      device_ids: JSON.stringify(clock.deviceIds),
      created_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (result.error) fail(result.error, "שמירת השעון נכשלה. הריצו את supabase/schema.sql");
}

export async function deleteDayClock(tenantId: string, id: string) {
  await ready();
  const result = await client().from("clocks").delete().eq("tenant_id", tenantId).eq("id", id).select("id");
  if (result.error) fail(result.error, "מחיקת השעון נכשלה");
  if (!result.data?.length) throw new HttpError(404, "השעון לא נמצא");
}

export async function listRunsFor(programId: string): Promise<ProgramRun[]> {
  await ready();
  const result = await client()
    .from("program_runs")
    .select("id, program_id, device_id, action, run_at, label, attempts")
    .eq("program_id", programId)
    .is("done_at", null)
    .order("run_at");
  if (result.error) {
    if (result.error.code === "42P01" || result.error.code === "PGRST205") return [];
    fail(result.error, "לא ניתן לקרוא זמני תוכנית");
  }
  return (result.data ?? []).map(mapRun);
}

export async function replaceProgramRuns(programId: string, runs: ProgramRunInput[]) {
  await ready();
  const removed = await client().from("program_runs").delete().eq("program_id", programId).is("done_at", null);
  if (removed.error) fail(removed.error, "עדכון זמני התוכנית נכשל");
  if (!runs.length) return;
  const now = new Date().toISOString();
  const inserted = await client()
    .from("program_runs")
    .insert(
      runs.map((run) => ({
        id: `run_${randomUUID()}`,
        program_id: programId,
        device_id: run.deviceId,
        action: run.action,
        run_at: run.runAt,
        label: run.label.slice(0, 180),
        created_at: now,
        done_at: null,
        attempts: 0,
        detail: null,
      })),
    );
  if (inserted.error) fail(inserted.error, "עדכון זמני התוכנית נכשל");
}

export async function listProgramRuns(tenantId: string): Promise<ProgramRun[]> {
  await ready();
  const programs = await client().from("programs").select("id").eq("tenant_id", tenantId);
  if (programs.error) fail(programs.error, "לא ניתן לקרוא תוכניות");
  const ids = (programs.data ?? []).map((row) => String(row.id));
  if (!ids.length) return [];
  const result = await client()
    .from("program_runs")
    .select("id, program_id, device_id, action, run_at, label, attempts")
    .in("program_id", ids)
    .is("done_at", null)
    .order("run_at");
  if (result.error) fail(result.error, "לא ניתן לקרוא זמני תוכנית");
  return (result.data ?? []).map(mapRun);
}

export async function listDueProgramRuns(now = new Date().toISOString()): Promise<ProgramRun[]> {
  await ready();
  const result = await client()
    .from("program_runs")
    .select("id, program_id, device_id, action, run_at, label, attempts")
    .is("done_at", null)
    .lt("attempts", 8)
    .lte("run_at", now)
    .order("run_at")
    .limit(20);
  if (result.error) {
    if (result.error.code === "42P01" || result.error.code === "PGRST205") return [];
    fail(result.error, "קריאת תוכניות נכשלה");
  }
  return (result.data ?? []).map(mapRun);
}

export async function finishProgramRun(id: string) {
  await ready();
  const result = await client().from("program_runs").update({ done_at: new Date().toISOString() }).eq("id", id);
  if (result.error) fail(result.error, "עדכון תוכנית נכשל");
}

export async function failProgramRun(id: string, detail: string) {
  await ready();
  const current = await client().from("program_runs").select("attempts").eq("id", id).maybeSingle();
  if (current.error) fail(current.error, "עדכון תוכנית נכשל");
  const attempts = Number(current.data?.attempts ?? 0) + 1;
  const result = await client()
    .from("program_runs")
    .update({
      attempts,
      detail: detail.slice(0, 300),
      done_at: attempts >= 8 ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (result.error) fail(result.error, "עדכון תוכנית נכשל");
}

function mapRun(row: {
  id: string;
  program_id: string;
  device_id: string;
  action: string;
  run_at: string;
  label: string;
  attempts: number | null;
}): ProgramRun {
  return {
    id: String(row.id),
    programId: String(row.program_id),
    deviceId: String(row.device_id),
    action: row.action === "OFF" ? "OFF" : "ON",
    runAt: String(row.run_at),
    label: String(row.label),
    attempts: Number(row.attempts ?? 0),
  };
}

export async function failSchedule(id: string, detail: string) {
  await ready();
  const current = await client().from("schedules").select("attempts").eq("id", id).maybeSingle();
  if (current.error) fail(current.error, "עדכון טיימר נכשל");
  const attempts = Number(current.data?.attempts ?? 0) + 1;
  const result = await client()
    .from("schedules")
    .update({
      attempts,
      detail: detail.slice(0, 300),
      done_at: attempts >= 8 ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (result.error) fail(result.error, "עדכון טיימר נכשל");
}
