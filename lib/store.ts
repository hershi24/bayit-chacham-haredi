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
