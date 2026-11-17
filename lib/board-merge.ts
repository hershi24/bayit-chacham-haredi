import type { DeviceView } from "@/lib/types";

function timeOf(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

/**
 * A full board reload must not paint over a newer local relay.
 * Opening the dashboard refreshes every device, and that answer can land
 * after a click with the state from before the command.
 */
export function mergeBoardDevices(
  current: DeviceView[] | null,
  incoming: DeviceView[],
  pending: ReadonlyMap<string, boolean>,
): DeviceView[] {
  if (!current) {
    return incoming.map((device) => pinPending(device, pending));
  }
  const previous = new Map(current.map((device) => [device.deviceId, device]));
  return incoming.map((device) => {
    const wanted = pending.get(device.deviceId);
    if (wanted !== undefined) return { ...device, relayOn: wanted };
    const had = previous.get(device.deviceId);
    if (!had) return device;
    const incomingTime = timeOf(device.stateUpdatedAt);
    const previousTime = timeOf(had.stateUpdatedAt);
    if (Number.isFinite(incomingTime) && Number.isFinite(previousTime) && incomingTime < previousTime) {
      return { ...device, relayOn: had.relayOn, stateUpdatedAt: had.stateUpdatedAt };
    }
    return device;
  });
}

function pinPending(device: DeviceView, pending: ReadonlyMap<string, boolean>): DeviceView {
  const wanted = pending.get(device.deviceId);
  return wanted === undefined ? device : { ...device, relayOn: wanted };
}
