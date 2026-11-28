import { isNewerIso } from "@/lib/wlte/parse";

/** A quiet socket still records that it was seen, without a write on every identical sample. */
export const STATE_STAMP_REFRESH_MS = 10 * 60 * 1000;

export type ObservedState = {
  connectivity: string;
  relayOn: boolean | null;
  deviceType: string | null;
  sensorSummary: string | null;
  lastError: string | null;
};

const seen = new Map<string, string>();

export function resetStateStamps() {
  seen.clear();
}

export function noteStateStamp(deviceId: string, stamp: string | null | undefined) {
  if (!stamp) return;
  const previous = seen.get(deviceId) ?? null;
  if (isNewerIso(previous, stamp)) seen.set(deviceId, stamp);
}

/** True when the sample is newer than both the database stamp and a newer sample this process already accepted. */
export function incomingStateIsNewer(deviceId: string, stored: string | null, incoming: string | null | undefined): boolean {
  if (!incoming) return false;
  const known = seen.get(deviceId) ?? null;
  const base = isNewerIso(stored, known) ? known : stored;
  return isNewerIso(base, incoming);
}

export function sameObservedState(current: ObservedState, next: ObservedState): boolean {
  return (
    current.connectivity === next.connectivity &&
    current.relayOn === next.relayOn &&
    current.deviceType === next.deviceType &&
    current.sensorSummary === next.sensorSummary &&
    (current.lastError ?? null) === (next.lastError ?? null)
  );
}

/**
 * Write a real change immediately. An identical sample is kept in memory, and the stored stamp
 * moves forward only after it is older than the refresh window, so a restart still has a recent order.
 */
export function shouldPersistObservedState(
  current: ObservedState,
  next: ObservedState,
  storedStamp: string | null,
  incomingStamp: string | null,
  refreshMs = STATE_STAMP_REFRESH_MS,
): boolean {
  if (!sameObservedState(current, next)) return true;
  if (!storedStamp) return true;
  if (!incomingStamp) return false;
  const stored = Date.parse(storedStamp);
  const incoming = Date.parse(incomingStamp);
  if (Number.isNaN(stored) || Number.isNaN(incoming)) return true;
  return incoming - stored >= refreshMs;
}
