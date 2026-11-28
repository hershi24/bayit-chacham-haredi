import { STATE_STAMP_REFRESH_MS } from "@/lib/devices/state-write";
import { isNewerIso, type NormalizedEvent } from "@/lib/wlte/parse";

/**
 * A device clock that jumps back by at least this much is a restart, not a late copy of an old sample.
 * Smaller gaps stay ordered, so a replay cannot overwrite a newer relay.
 */
export const WLTE_STAMP_RESET_MS = 60 * 60 * 1000;

export type WlteReportDecision = "cold" | "change" | "refresh" | "reset" | "duplicate";

export type WlteMemory = {
  relayOn: boolean | null;
  connectivity: string | null;
  stamp: string | null;
};

export type StoredWlteState = {
  relayOn: boolean | null;
  connectivity: string;
  stateUpdatedAt: string | null;
};

export type WlteStatePatch = {
  connectivity?: "ONLINE" | "OFFLINE";
  relayOn?: boolean | null;
  stateUpdatedAt?: string | null;
  lastError?: null;
};

export type SettledWlteReport = {
  patch: WlteStatePatch | null;
  remember: {
    relayOn: boolean | null;
    connectivity: string;
    stateUpdatedAt: string | null;
  };
};

const reports = new Map<string, WlteMemory>();

export function resetWlteReports() {
  reports.clear();
}

export function forgetWlteReport(deviceId: string) {
  reports.delete(deviceId);
}

export function rememberWlteReport(
  deviceId: string,
  state: { relayOn: boolean | null; connectivity: string | null; stateUpdatedAt: string | null },
) {
  reports.set(deviceId, {
    relayOn: state.relayOn,
    connectivity: state.connectivity,
    stamp: state.stateUpdatedAt,
  });
}

/** Move only the remembered stamp. Used when a device clock restarts and the relay did not change. */
export function noteWlteReportStamp(deviceId: string, stamp: string | null) {
  const seen = reports.get(deviceId);
  if (!seen || !stamp) return;
  reports.set(deviceId, { ...seen, stamp });
}

function ageMs(previous: string | null, incoming: string | null): number | null {
  if (!previous || !incoming) return null;
  const prev = Date.parse(previous);
  const next = Date.parse(incoming);
  if (Number.isNaN(prev) || Number.isNaN(next)) return null;
  return next - prev;
}

function laterStamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return isNewerIso(left, right) ? right : left;
}

/**
 * Decide before any database read.
 * A repeated sample is a duplicate. A relay or link change is not, even when the stamp is unchanged.
 * A stamp that falls back by an hour or more is a clock reset, not a reason to skip a later real change.
 */
export function classifyWlteReport(event: NormalizedEvent): WlteReportDecision {
  const seen = reports.get(event.deviceId);
  if (!seen) return "cold";
  if (event.type === "connectivity" && event.topic === "device.power.restored") return "change";
  if (event.type === "connectivity") {
    if (event.connectivity !== seen.connectivity) return "change";
  } else if (event.relayOn !== null && event.relayOn !== seen.relayOn) {
    const delta = ageMs(seen.stamp, event.stateUpdatedAt);
    if (delta !== null && delta < 0 && delta > -WLTE_STAMP_RESET_MS) return "duplicate";
    return "change";
  }
  const delta = ageMs(seen.stamp, event.stateUpdatedAt);
  if (delta !== null && delta <= -WLTE_STAMP_RESET_MS) return "reset";
  if (delta !== null && delta >= STATE_STAMP_REFRESH_MS) return "refresh";
  return "duplicate";
}

/**
 * After the one device read: write a real change, refresh a quiet stamp, and ignore a stale relay replay.
 * An unchanged sample does not write an older stamp over the stored one.
 */
export function settleWlteReport(
  decision: Exclude<WlteReportDecision, "duplicate" | "reset">,
  event: NormalizedEvent,
  stored: StoredWlteState,
  now = new Date().toISOString(),
): SettledWlteReport {
  const reportedRelay = event.type === "state" && event.relayOn !== null ? event.relayOn : stored.relayOn;
  const reportedLink = event.type === "connectivity" ? event.connectivity : stored.connectivity;
  const delta = ageMs(stored.stateUpdatedAt, event.stateUpdatedAt);
  const older = delta !== null && delta < 0;
  const jumped = delta !== null && delta <= -WLTE_STAMP_RESET_MS;
  const staleRelay =
    event.type === "state" && event.relayOn !== null && event.relayOn !== stored.relayOn && older && !jumped;

  if (staleRelay) {
    return {
      patch: null,
      remember: {
        relayOn: stored.relayOn,
        connectivity: stored.connectivity,
        stateUpdatedAt: stored.stateUpdatedAt,
      },
    };
  }

  const changed = reportedRelay !== stored.relayOn || reportedLink !== stored.connectivity;
  if (!changed && decision !== "refresh") {
    const stamp = jumped ? event.stateUpdatedAt : laterStamp(stored.stateUpdatedAt, event.stateUpdatedAt);
    return {
      patch: null,
      remember: {
        relayOn: stored.relayOn,
        connectivity: stored.connectivity,
        stateUpdatedAt: stamp,
      },
    };
  }

  if (!changed) {
    return {
      patch: event.stateUpdatedAt ? { stateUpdatedAt: event.stateUpdatedAt } : null,
      remember: {
        relayOn: stored.relayOn,
        connectivity: stored.connectivity,
        stateUpdatedAt: event.stateUpdatedAt ?? stored.stateUpdatedAt,
      },
    };
  }

  const stamp = !event.stateUpdatedAt ? now : older && !jumped ? stored.stateUpdatedAt : event.stateUpdatedAt;
  if (event.type === "connectivity") {
    return {
      patch: { connectivity: event.connectivity, stateUpdatedAt: stamp },
      remember: {
        relayOn: stored.relayOn,
        connectivity: event.connectivity,
        stateUpdatedAt: stamp,
      },
    };
  }
  return {
    patch: { relayOn: reportedRelay, stateUpdatedAt: stamp, lastError: null },
    remember: {
      relayOn: reportedRelay,
      connectivity: stored.connectivity,
      stateUpdatedAt: stamp,
    },
  };
}
