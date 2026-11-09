import { canAccessDevice } from "@/lib/access";
import { earliestPlan } from "@/lib/devices/upcoming";
import type { ClockSettings } from "@/lib/hebrew/calendar";
import { HttpError } from "@/lib/http-error";
import type { DayClock, ProgramRunInput, StoredProgram } from "@/lib/programs/types";
import type { ScheduleKind } from "@/lib/schedules/types";
import type { DeviceView, Role, SessionUser } from "@/lib/types";
import { storageMode } from "@/lib/storage";
import * as remote from "@/lib/store-supabase";
import * as sqlite from "@/lib/store-sqlite";

export type { StatePatch } from "@/lib/store-sqlite";
export { presentDevice } from "@/lib/store-sqlite";

function remoteOn() {
  return storageMode() === "supabase";
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
  if (!device) return null;
  const [withNext] = await withPlans([device]);
  return withNext;
}

export async function setDeviceName(deviceId: string, name: string) {
  const device = remoteOn() ? await remote.setDeviceName(deviceId, name) : sqlite.setDeviceName(deviceId, name);
  if (!device) return null;
  const [withNext] = await withPlans([device]);
  return withNext;
}

export async function listTenants() {
  if (remoteOn()) return remote.listTenants();
  return sqlite.listTenants();
}

export async function createTenant(input: { name: string; phone: string | null }) {
  if (remoteOn()) return remote.createTenant(input);
  return sqlite.createTenant(input);
}

export async function renameTenant(id: string, name: string) {
  if (remoteOn()) return remote.renameTenant(id, name);
  return sqlite.renameTenant(id, name);
}

export async function createCustomer(input: { name: string; username: string; password: string; phone: string | null }) {
  if (remoteOn()) return remote.createCustomer(input);
  return sqlite.createCustomer(input);
}

export async function deleteTenant(id: string) {
  if (remoteOn()) return remote.deleteTenant(id);
  return sqlite.deleteTenant(id);
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

export async function updateUser(input: {
  id: string;
  actorId: string;
  name: string;
  role: Role;
  tenantId: string | null;
  password: string | null;
  deviceIds: string[] | null;
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
  if (remoteOn()) return remote.setDeviceFrozen(deviceId, frozen);
  return sqlite.setDeviceFrozen(deviceId, frozen);
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
  if (remoteOn()) return remote.createDevice(input);
  return sqlite.createDevice(input);
}

export async function createShellyPro3(input: {
  shellyId: string;
  tenantId: string;
  kind: DeviceView["kind"];
  channels: [string, string, string];
}) {
  if (remoteOn()) return remote.createShellyPro3(input);
  return sqlite.createShellyPro3(input);
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
  if (remoteOn()) return remote.updateDevice(input);
  return sqlite.updateDevice(input);
}

export async function deleteDevice(deviceId: string): Promise<string[]> {
  if (remoteOn()) return remote.deleteDevice(deviceId);
  return sqlite.deleteDevice(deviceId);
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

export async function listAudit(user: { role: Role; tenantId: string | null }, limit = 100) {
  if (remoteOn()) return remote.listAudit(user, limit);
  return sqlite.listAudit(user, limit);
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

export async function failSchedule(id: string, detail: string) {
  if (remoteOn()) return remote.failSchedule(id, detail);
  return sqlite.failSchedule(id, detail);
}

export async function listTenantDevices(tenantId: string) {
  if (remoteOn()) return remote.listTenantDevices(tenantId);
  return sqlite.listTenantDevices(tenantId);
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

export async function listProgramRuns(tenantId: string) {
  if (remoteOn()) return remote.listProgramRuns(tenantId);
  return sqlite.listProgramRuns(tenantId);
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
