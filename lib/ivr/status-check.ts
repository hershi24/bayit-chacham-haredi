import { getBridge } from "@/lib/wlte/bridge";

type Refresh = ReturnType<ReturnType<typeof getBridge>["refresh"]>;

const inflight = new Map<string, Refresh>();
const recent = new Map<string, Refresh>();
const running = new Set<string>();

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

/** Test helper — drop cached fetches so fixtures are not overwritten by a prior call. */
export function resetStatusChecks() {
  inflight.clear();
  recent.clear();
  running.clear();
}
