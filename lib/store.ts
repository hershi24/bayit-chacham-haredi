import type { ClockSettings } from "@/lib/hebrew/calendar";
import type { DayClock, ProgramRunInput, StoredProgram } from "@/lib/programs/types";
import type { ScheduleKind } from "@/lib/schedules/types";
import type { Role } from "@/lib/types";
import { storageMode } from "@/lib/storage";
import * as remote from "@/lib/store-supabase";
import * as sqlite from "@/lib/store-sqlite";

export type { StatePatch } from "@/lib/store-sqlite";
export { presentDevice } from "@/lib/store-sqlite";

function remoteOn() {
  return storageMode() === "supabase";
}

export async function listDevices(user: { role: Role; tenantId: string | null }) {
  if (remoteOn()) return remote.listDevices(user);
  return sqlite.listDevices(user);
}

export async function listIvrTargets() {
  if (remoteOn()) return remote.listIvrTargets();
  return sqlite.listIvrTargets();
}

export async function getDevice(deviceId: string) {
  if (remoteOn()) return remote.getDevice(deviceId);
  return sqlite.getDevice(deviceId);
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
  if (remoteOn()) return remote.updateDeviceState(deviceId, patch, options);
  return sqlite.updateDeviceState(deviceId, patch, options);
}

export async function listTenants() {
  if (remoteOn()) return remote.listTenants();
  return sqlite.listTenants();
}

export async function createTenant(input: { name: string; phone: string | null }) {
  if (remoteOn()) return remote.createTenant(input);
  return sqlite.createTenant(input);
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

export async function createDevice(input: { deviceId: string; name: string; tenantId: string }) {
  if (remoteOn()) return remote.createDevice(input);
  return sqlite.createDevice(input);
}

export async function updateDevice(input: { deviceId: string; name: string; tenantId: string }) {
  if (remoteOn()) return remote.updateDevice(input);
  return sqlite.updateDevice(input);
}

export async function deleteDevice(deviceId: string) {
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

export async function listRunsFor(programId: string) {
  if (remoteOn()) return remote.listRunsFor(programId);
  return sqlite.listRunsFor(programId);
}
