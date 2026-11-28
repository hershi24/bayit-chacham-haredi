import { STATE_STAMP_REFRESH_MS } from "@/lib/devices/state-write";
import type { ShellyChannel } from "@/lib/shelly/ids";
import { shellyIdsMatch, shellyMac } from "@/lib/shelly/ids";
import { staleRelayReport, type RelayHold } from "@/lib/shelly/relay-hold";
import type { DeviceView } from "@/lib/types";

export type ShellySwitchReport = { channel: ShellyChannel; on: boolean };

type SavedChannel = {
  deviceId: string;
  channel: ShellyChannel;
  relayOn: boolean | null;
  connectivity: string;
  lastError: string | null;
  persistedAt: string | null;
};

type UnitRecord = {
  keys: string[];
  channels: SavedChannel[];
};

const units: UnitRecord[] = [];
let databaseTouches = 0;
let statusApplies = 0;

export function resetShellyStatusBook() {
  units.length = 0;
  databaseTouches = 0;
  statusApplies = 0;
}

/** Drop remembered rows after a device is moved, renamed, deleted, or its settings change. */
export function forgetShellyStatus() {
  units.length = 0;
}

export function noteShellyDatabaseTouch() {
  databaseTouches += 1;
}

export function noteShellyStatusApplied() {
  statusApplies += 1;
}

export function shellyDatabaseTouches() {
  return databaseTouches;
}

export function shellyStatusApplies() {
  return statusApplies;
}

function asChannel(value: number | null | undefined): ShellyChannel | null {
  return value === 0 || value === 1 || value === 2 ? value : null;
}

function findUnit(shellyId: string): UnitRecord | undefined {
  const id = shellyId.trim().toLowerCase();
  if (!id) return undefined;
  return units.find((unit) => unit.keys.some((key) => shellyIdsMatch(key, id)));
}

function savedFrom(device: DeviceView, channel: ShellyChannel): SavedChannel {
  return {
    deviceId: device.deviceId,
    channel,
    relayOn: device.relayOn,
    connectivity: device.connectivity,
    lastError: device.lastError ?? null,
    persistedAt: device.stateUpdatedAt,
  };
}

function addKeys(unit: UnitRecord, shellyId: string, devices: DeviceView[]) {
  const keys = new Set(unit.keys);
  const id = shellyId.trim().toLowerCase();
  if (id) keys.add(id);
  const ownMac = shellyMac(id);
  if (ownMac) keys.add(ownMac);
  for (const device of devices) {
    if (!device.externalId) continue;
    const external = device.externalId.trim().toLowerCase();
    keys.add(external);
    const mac = shellyMac(external);
    if (mac) keys.add(mac);
  }
  unit.keys = [...keys];
}

/**
 * Remember rows already stored. Existing channels stay as last successful write,
 * so a slower read cannot cover a command that landed while the read was in flight.
 */
export function seedShellyUnit(shellyId: string, devices: DeviceView[]) {
  const existing = findUnit(shellyId);
  const unit: UnitRecord = existing ?? { keys: [], channels: [] };
  addKeys(unit, shellyId, devices);
  for (const device of devices) {
    const channel = asChannel(device.channel);
    if (channel === null) continue;
    const already = unit.channels.some((item) => item.deviceId === device.deviceId || item.channel === channel);
    if (already) continue;
    unit.channels.push(savedFrom(device, channel));
  }
  if (!existing) units.push(unit);
}

/**
 * Remember a row only after the database accepted it.
 * A null view means the write did not stick, and the previous memory stays.
 */
export function rememberShellyWrite(shellyId: string, view: DeviceView | null): boolean {
  if (!view) return false;
  const channel = asChannel(view.channel);
  if (channel === null) return false;
  const saved = savedFrom(view, channel);
  const unit = findUnit(shellyId) ?? findUnit(view.externalId ?? "");
  if (!unit) {
    const created: UnitRecord = { keys: [], channels: [saved] };
    addKeys(created, shellyId, [view]);
    units.push(created);
    return true;
  }
  addKeys(unit, shellyId, [view]);
  const index = unit.channels.findIndex((item) => item.deviceId === view.deviceId || item.channel === channel);
  if (index === -1) unit.channels.push(saved);
  else unit.channels[index] = saved;
  return true;
}

function stampDue(persistedAt: string | null, now: number) {
  if (!persistedAt) return true;
  const at = Date.parse(persistedAt);
  if (Number.isNaN(at)) return true;
  return now - at >= STATE_STAMP_REFRESH_MS;
}

function channelIsQuiet(saved: SavedChannel, reportedOn: boolean, now: number, hold: RelayHold | undefined) {
  const relay = staleRelayReport(hold, reportedOn, now) ? saved.relayOn : reportedOn;
  if (relay !== saved.relayOn) return false;
  if (saved.connectivity !== "ONLINE") return false;
  if ((saved.lastError ?? null) !== null) return false;
  return !stampDue(saved.persistedAt, now);
}

/** True when every reported switch already matches memory, so the frame needs no database call. */
export function shellyStatusIsQuiet(
  shellyId: string,
  states: ShellySwitchReport[],
  now: number,
  holdFor: (deviceId: string) => RelayHold | undefined,
): boolean {
  if (!states.length) return true;
  const unit = findUnit(shellyId);
  if (!unit) return false;
  for (const state of states) {
    const saved = unit.channels.find((item) => item.channel === state.channel);
    if (!saved) return false;
    if (!channelIsQuiet(saved, state.on, now, holdFor(saved.deviceId))) return false;
  }
  return true;
}

export function shellyUnitIsOnline(shellyId: string, now = Date.now()): boolean {
  const unit = findUnit(shellyId);
  if (!unit || unit.channels.length === 0) return false;
  return unit.channels.every(
    (channel) => channel.connectivity === "ONLINE" && (channel.lastError ?? null) === null && !stampDue(channel.persistedAt, now),
  );
}

export function shellyUnitIsOffline(shellyId: string): boolean {
  const unit = findUnit(shellyId);
  if (!unit || unit.channels.length === 0) return false;
  return unit.channels.every((channel) => channel.connectivity === "OFFLINE");
}

export function shellySavedChannel(shellyId: string, channel: ShellyChannel): SavedChannel | undefined {
  return findUnit(shellyId)?.channels.find((item) => item.channel === channel);
}
