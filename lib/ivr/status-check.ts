import { getBridge } from "@/lib/wlte/bridge";

type Refresh = ReturnType<ReturnType<typeof getBridge>["refresh"]>;
type DeviceView = Awaited<Refresh>;

const inflight = new Map<string, Refresh>();
const recent = new Map<string, Refresh>();
const running = new Set<string>();

/** How long the phone menu may block on a live status check before speaking from last-known state. */
export const IVR_STATUS_BUDGET_MS = 1_200;

/** Shared live status fetch so IVR can start it during the device list and reuse it. */
export function ensureStatusCheck(deviceId: string): Refresh {
  const live = inflight.get(deviceId);
  if (live) return live;
  const cached = recent.get(deviceId);
  if (cached) return cached;

  running.add(deviceId);
  const job = getBridge().refresh(deviceId);
  inflight.set(deviceId, job);
  void job
    .finally(() => {
      running.delete(deviceId);
      inflight.delete(deviceId);
      recent.set(deviceId, job);
      setTimeout(() => {
        if (recent.get(deviceId) === job) recent.delete(deviceId);
      }, 15_000);
    })
    .catch(() => {});
  return job;
}

export function statusCheckRunning(deviceId: string) {
  return running.has(deviceId);
}

/**
 * Prefer a fresh reading, but never leave the caller silent for the full WLTE/Shelly timeout.
 * Returns null when the budget runs out; the menu then uses the last stored state.
 */
export async function awaitStatusCheck(deviceId: string, budgetMs = IVR_STATUS_BUDGET_MS): Promise<DeviceView | null> {
  const job = ensureStatusCheck(deviceId);
  if (!running.has(deviceId)) {
    try {
      return await job;
    } catch {
      return null;
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      job.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Test helper — drop cached fetches so fixtures are not overwritten by a prior call. */
export function resetStatusChecks() {
  inflight.clear();
  recent.clear();
  running.clear();
}
