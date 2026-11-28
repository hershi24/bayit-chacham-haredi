import { canAccessDevice } from "@/lib/access";
import { earliestPlan } from "@/lib/devices/upcoming";
import type { ClockSettings } from "@/lib/hebrew/calendar";
import { HttpError } from "@/lib/http-error";
import type { DayClock, ProgramRunInput, StoredProgram } from "@/lib/programs/types";
import type { ScheduleKind } from "@/lib/schedules/types";
import type { DeviceView, Role, SessionUser } from "@/lib/types";
import type { ShellyBackupGate, ShellyBackupRow } from "@/lib/shelly/backup-record";
import { createKeyedCache, createSingleCache } from "@/lib/store-cache";
import { storageMode } from "@/lib/storage";
import * as remote from "@/lib/store-supabase";
import * as sqlite from "@/lib/store-sqlite";

export type { StatePatch } from "@/lib/store-sqlite";
export { presentDevice } from "@/lib/store-sqlite";

function remoteOn() {
  return storageMode() === "supabase";
}

const READ_CACHE_MS = 60_000;
const tenantIdCache = createSingleCache<string[]>(READ_CACHE_MS);
const tenantDeviceCache = createKeyedCache<DeviceView[]>(READ_CACHE_MS);
const shellyBackupCache = createKeyedCache<ShellyBackupRow | null>(READ_CACHE_MS);
const shellyGateCache = createKeyedCache<ShellyBackupGate | null>(READ_CACHE_MS);

function forgetTenants() {
  tenantIdCache.clear();
}

function forgetDevices() {
  tenantDeviceCache.clear();
}

function forgetBackup(shellyId?: string) {
  if (!shellyId) {
    shellyBackupCache.clear();
    shellyGateCache.clear();
    return;
  }
  shellyBackupCache.delete(shellyId);
  shellyGateCache.delete(shellyId);
}

function rememberBackup(row: ShellyBackupRow | null, shellyId: string) {
  shellyBackupCache.set(shellyId, row);
  shellyGateCache.set(shellyId, row ? gateOf(row) : null);
}

function gateOf(row: ShellyBackupRow): ShellyBackupGate {
  return {
    status: row.status,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    watch: row.watch,
    nextCheckAt: row.nextCheckAt,
  };
}

const PLAN_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;

async function withPlans<T extends { deviceId: string }>(devices: T[]): Promise<Array<T & Pick<DeviceView, "next">>> {
  if (!devices.length) return [];
  const now = new Date();
  const until = new Date(now.getTime() + PLAN_HORIZON_MS).toISOString();
  const items = remoteOn()
    ? await remote.listUpcoming(now.toISOString(), until)
    : sqlite.listUpcoming(now.toISOString(), until);
  const plans = earliestPlan(items);
  return devices.map((device) => ({ ...device, next: plans.get(device.deviceId) ?? null }));
}

export async function listDevices(user: { id?: string; role: Role; tenantId: string | null }) {
  const devices = remoteOn() ? await remote.listDevices(user) : sqlite.listDevices(user);
  return withPlans(devices);
}

export async function visibleDeviceIds(user: { id: string; role: Role; tenantId: string | null }) {
  if (user.role === "admin") return null;
  return remoteOn() ? remote.grantsFor(user.id) : sqlite.grantsFor(user.id);
}

export async function assertMayUseDevice(user: SessionUser, device: { deviceId: string; tenantId: string }) {
  if (!canAccessDevice(user, device.tenantId)) throw new HttpError(403, "אין הרשאה לשקע הזה");
  const granted = await visibleDeviceIds(user);
  if (granted && !granted.includes(device.deviceId)) throw new HttpError(403, "אין הרשאה לשקע הזה");
}

export async function listIvrTargets() {
  if (remoteOn()) return remote.listIvrTargets();
  return sqlite.listIvrTargets();
}

export async function getDevice(deviceId: string) {
  const device = remoteOn() ? await remote.getDevice(deviceId) : sqlite.getDevice(deviceId);
  if (!device) return null;
  const [withNext] = await withPlans([device]);
  return withNext;
}

export async function listDeviceIds() {
  if (remoteOn()) return remote.listDeviceIds();
  return sqlite.listDeviceIds();
}

export async function updateDeviceState(
  deviceId: string,
  patch: sqlite.StatePatch,
  options?: { onlyIfNewer?: boolean },
) {
  const device = remoteOn()
    ? await remote.updateDeviceState(deviceId, patch, options)
    : sqlite.updateDeviceState(deviceId, patch, options);
  if (!device) return null;
  const [withNext] = await withPlans([device]);
  return withNext;
}

export async function setDeviceIcon(deviceId: string, icon: string) {
  const device = remoteOn() ? await remote.setDeviceIcon(deviceId, icon) : sqlite.setDeviceIcon(deviceId, icon);
  forgetDevices();
  if (!device) return null;
  const [withNext] = await withPlans([device]);
  return withNext;
}

export async function setDeviceName(deviceId: string, name: string) {
  const device = remoteOn() ? await remote.setDeviceName(deviceId, name) : sqlite.setDeviceName(deviceId, name);
  forgetDevices();
  if (!device) return null;
  const [withNext] = await withPlans([device]);
  return withNext;
}

export async function saveDeviceOrder(tenantId: string, deviceIds: string[]) {
  const devices = remoteOn() ? await remote.saveDeviceOrder(tenantId, deviceIds) : sqlite.saveDeviceOrder(tenantId, deviceIds);
  forgetDevices();
  return withPlans(devices);
}

export async function listTenants() {
  if (remoteOn()) return remote.listTenants();
  return sqlite.listTenants();
}

export async function listTenantIds() {
  const cached = tenantIdCache.get();
  if (cached) return cached;
  const ids = remoteOn() ? await remote.listTenantIds() : sqlite.listTenantIds();
  tenantIdCache.set(ids);
  return ids;
}

export async function createTenant(input: { name: string; phone: string | null }) {
  const tenant = remoteOn() ? await remote.createTenant(input) : sqlite.createTenant(input);
  forgetTenants();
  return tenant;
}

export async function renameTenant(id: string, name: string) {
  if (remoteOn()) return remote.renameTenant(id, name);
  return sqlite.renameTenant(id, name);
}

export async function createCustomer(input: { name: string; username: string; password: string; phone: string | null }) {
  const customer = remoteOn() ? await remote.createCustomer(input) : sqlite.createCustomer(input);
  forgetTenants();
  return customer;
}

export async function deleteTenant(id: string) {
  if (remoteOn()) await remote.deleteTenant(id);
  else sqlite.deleteTenant(id);
  forgetTenants();
  forgetDevices();
  forgetBackup();
}

export async function listUsers() {
  if (remoteOn()) return remote.listUsers();
  return sqlite.listUsers();
}

export async function createUser(input: {
  username: string;
  name: string;
  password: string;
  role: Role;
  tenantId: string | null;
  email?: string | null;
}) {
  if (remoteOn()) return remote.createUser(input);
  return sqlite.createUser(input);
}

export async function deleteUser(id: string, actorId: string) {
  if (remoteOn()) return remote.deleteUser(id, actorId);
  return sqlite.deleteUser(id, actorId);
}

export async function changeOwnPassword(userId: string, currentPassword: string, nextPassword: string) {
  if (remoteOn()) return remote.changeOwnPassword(userId, currentPassword, nextPassword);
  return sqlite.changeOwnPassword(userId, currentPassword, nextPassword);
}

export async function setUserEmail(userId: string, email: string | null) {
  if (remoteOn()) return remote.setUserEmail(userId, email);
  return sqlite.setUserEmail(userId, email);
}

export async function getUserEmail(userId: string) {
  if (remoteOn()) return remote.getUserEmail(userId);
  return sqlite.getUserEmail(userId);
}

export async function findUserIdByEmail(email: string) {
  if (remoteOn()) return remote.findUserIdByEmail(email);
  return sqlite.findUserIdByEmail(email);
}

export async function findUserIdByGoogleSub(sub: string) {
  if (remoteOn()) return remote.findUserIdByGoogleSub(sub);
  return sqlite.findUserIdByGoogleSub(sub);
}

export async function linkGoogleAccount(userId: string, sub: string, email: string) {
  if (remoteOn()) return remote.linkGoogleAccount(userId, sub, email);
  return sqlite.linkGoogleAccount(userId, sub, email);
}

export async function issuePasswordReset(userId: string) {
  if (remoteOn()) return remote.issuePasswordReset(userId);
  return sqlite.issuePasswordReset(userId);
}

export async function consumePasswordReset(token: string) {
  if (remoteOn()) return remote.consumePasswordReset(token);
  return sqlite.consumePasswordReset(token);
}

export async function replacePassword(userId: string, password: string) {
  if (remoteOn()) return remote.replacePassword(userId, password);
  return sqlite.replacePassword(userId, password);
}

export async function updateUser(input: {
  id: string;
  actorId: string;
  name: string;
  role: Role;
  tenantId: string | null;
  password: string | null;
  deviceIds: string[] | null;
  email?: string | null;
}) {
  if (remoteOn()) return remote.updateUser(input);
  return sqlite.updateUser(input);
}

export async function listCallerNumbers(tenantId: string) {
  if (remoteOn()) return remote.listCallerNumbers(tenantId);
  return sqlite.listCallerNumbers(tenantId);
}

export async function addCallerNumber(tenantId: string, phone: string, label: string | null = null) {
  if (remoteOn()) return remote.addCallerNumber(tenantId, phone, label);
  return sqlite.addCallerNumber(tenantId, phone, label);
}

export async function updateCallerNumber(tenantId: string, id: string, input: { label: string | null }) {
  if (remoteOn()) return remote.updateCallerNumber(tenantId, id, input);
  return sqlite.updateCallerNumber(tenantId, id, input);
}

export async function removeCallerNumber(tenantId: string, id: string) {
  if (remoteOn()) return remote.removeCallerNumber(tenantId, id);
  return sqlite.removeCallerNumber(tenantId, id);
}

export async function setDeviceFrozen(deviceId: string, frozen: boolean) {
  const device = remoteOn() ? await remote.setDeviceFrozen(deviceId, frozen) : sqlite.setDeviceFrozen(deviceId, frozen);
  forgetDevices();
  return device;
}

export async function createDevice(input: {
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
  if (remoteOn()) await remote.createDevice(input);
  else sqlite.createDevice(input);
  forgetDevices();
}

export async function createShellyPro3(input: {
  shellyId: string;
  tenantId: string;
  kind: DeviceView["kind"];
  channels: [string, string, string];
}) {
  const created = remoteOn() ? await remote.createShellyPro3(input) : sqlite.createShellyPro3(input);
  forgetDevices();
  return created;
}

export async function listDevicesByExternalId(externalId: string) {
  if (remoteOn()) return remote.listDevicesByExternalId(externalId);
  return sqlite.listDevicesByExternalId(externalId);
}

export async function findShellyDevices(anyId: string) {
  if (remoteOn()) return remote.findShellyDevices(anyId);
  return sqlite.findShellyDevices(anyId);
}

export async function updateDevice(input: { deviceId: string; name: string; tenantId: string }) {
  const device = remoteOn() ? await remote.updateDevice(input) : sqlite.updateDevice(input);
  forgetDevices();
  return device;
}

export async function deleteDevice(deviceId: string): Promise<string[]> {
  const removed = remoteOn() ? await remote.deleteDevice(deviceId) : sqlite.deleteDevice(deviceId);
  forgetDevices();
  forgetBackup();
  return removed;
}

export async function findUserForLogin(username: string) {
  if (remoteOn()) return remote.findUserForLogin(username);
  return sqlite.findUserForLogin(username);
}

export async function createSession(userId: string) {
  if (remoteOn()) return remote.createSession(userId);
  return sqlite.createSession(userId);
}

export async function readSession(id: string) {
  if (remoteOn()) return remote.readSession(id);
  return sqlite.readSession(id);
}

export async function deleteSession(id: string) {
  if (remoteOn()) return remote.deleteSession(id);
  return sqlite.deleteSession(id);
}

export async function addAudit(entry: Parameters<typeof sqlite.addAudit>[0]) {
  if (remoteOn()) return remote.addAudit(entry);
  return sqlite.addAudit(entry);
}

export async function listAudit(user: { role: Role; tenantId: string | null }, limit = 100, onlyTenant?: string | null) {
  if (remoteOn()) return remote.listAudit(user, limit, onlyTenant);
  return sqlite.listAudit(user, limit, onlyTenant);
}

export async function saveSchedule(input: { deviceId: string; kind: ScheduleKind; runAt: string }) {
  if (remoteOn()) return remote.saveSchedule(input);
  return sqlite.saveSchedule(input);
}

export async function listDueSchedules(now = new Date().toISOString()) {
  if (remoteOn()) return remote.listDueSchedules(now);
  return sqlite.listDueSchedules(now);
}

export async function finishSchedule(id: string) {
  if (remoteOn()) return remote.finishSchedule(id);
  return sqlite.finishSchedule(id);
}

export async function listTenantSchedules(tenantId: string) {
  if (remoteOn()) return remote.listTenantSchedules(tenantId);
  return sqlite.listTenantSchedules(tenantId);
}

export async function cancelSchedule(tenantId: string, id: string) {
  if (remoteOn()) return remote.cancelSchedule(tenantId, id);
  return sqlite.cancelSchedule(tenantId, id);
}

export async function failSchedule(id: string, detail: string) {
  if (remoteOn()) return remote.failSchedule(id, detail);
  return sqlite.failSchedule(id, detail);
}

export async function listTenantDevices(tenantId: string) {
  const cached = tenantDeviceCache.get(tenantId);
  if (cached) return cached;
  const devices = remoteOn() ? await remote.listTenantDevices(tenantId) : sqlite.listTenantDevices(tenantId);
  tenantDeviceCache.set(tenantId, devices);
  return devices;
}

export async function getClock(tenantId: string) {
  if (remoteOn()) return remote.getClock(tenantId);
  return sqlite.getClock(tenantId);
}

export async function saveClock(tenantId: string, settings: ClockSettings) {
  if (remoteOn()) return remote.saveClock(tenantId, settings);
  return sqlite.saveClock(tenantId, settings);
}

export async function listPrograms(tenantId: string) {
  if (remoteOn()) return remote.listPrograms(tenantId);
  return sqlite.listPrograms(tenantId);
}

export async function upsertProgram(program: StoredProgram) {
  if (remoteOn()) return remote.upsertProgram(program);
  return sqlite.upsertProgram(program);
}

export async function deleteProgram(tenantId: string, id: string) {
  if (remoteOn()) return remote.deleteProgram(tenantId, id);
  return sqlite.deleteProgram(tenantId, id);
}

export async function replaceProgramRuns(programId: string, runs: ProgramRunInput[]) {
  if (remoteOn()) return remote.replaceProgramRuns(programId, runs);
  return sqlite.replaceProgramRuns(programId, runs);
}

export async function listDeviceProgramRuns(deviceId: string, fromIso: string, toIso: string) {
  if (remoteOn()) return remote.listDeviceProgramRuns(deviceId, fromIso, toIso);
  return sqlite.listDeviceProgramRuns(deviceId, fromIso, toIso);
}

export async function listProgramRuns(tenantId: string) {
  if (remoteOn()) return remote.listProgramRuns(tenantId);
  return sqlite.listProgramRuns(tenantId);
}

export async function getShellyBackup(shellyId: string) {
  const cached = shellyBackupCache.get(shellyId);
  if (cached !== undefined) return cached;
  const row = remoteOn() ? await remote.getShellyBackup(shellyId) : sqlite.getShellyBackup(shellyId);
  rememberBackup(row, shellyId);
  return row;
}

export async function getShellyBackupGate(shellyId: string) {
  const full = shellyBackupCache.get(shellyId);
  if (full !== undefined) return full ? gateOf(full) : null;
  const cached = shellyGateCache.get(shellyId);
  if (cached !== undefined) return cached;
  const row = remoteOn() ? await remote.getShellyBackupGate(shellyId) : sqlite.getShellyBackupGate(shellyId);
  shellyGateCache.set(shellyId, row);
  return row;
}

export async function listShellyBackups(tenantId: string) {
  if (remoteOn()) return remote.listShellyBackups(tenantId);
  return sqlite.listShellyBackups(tenantId);
}

export async function saveShellyBackup(row: Parameters<typeof sqlite.saveShellyBackup>[0]) {
  const saved = remoteOn() ? await remote.saveShellyBackup(row) : sqlite.saveShellyBackup(row);
  rememberBackup(saved, saved.shellyId);
  return saved;
}

export async function listDueProgramRuns(now = new Date().toISOString()) {
  if (remoteOn()) return remote.listDueProgramRuns(now);
  return sqlite.listDueProgramRuns(now);
}

export async function finishProgramRun(id: string) {
  if (remoteOn()) return remote.finishProgramRun(id);
  return sqlite.finishProgramRun(id);
}

export async function failProgramRun(id: string, detail: string) {
  if (remoteOn()) return remote.failProgramRun(id, detail);
  return sqlite.failProgramRun(id, detail);
}

export async function listDayClocks(tenantId: string) {
  if (remoteOn()) return remote.listDayClocks(tenantId);
  return sqlite.listDayClocks(tenantId);
}

export async function saveDayClock(clock: DayClock) {
  if (remoteOn()) return remote.saveDayClock(clock);
  return sqlite.saveDayClock(clock);
}

export async function deleteDayClock(tenantId: string, id: string) {
  if (remoteOn()) return remote.deleteDayClock(tenantId, id);
  return sqlite.deleteDayClock(tenantId, id);
}

export async function saveDateProgram(program: StoredProgram, clocks: DayClock[]) {
  if (remoteOn()) return remote.saveDateProgram(program, clocks);
  return sqlite.saveDateProgram(program, clocks);
}

export async function listRunsFor(programId: string) {
  if (remoteOn()) return remote.listRunsFor(programId);
  return sqlite.listRunsFor(programId);
}
