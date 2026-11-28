export type TrafficPeer = "supabase" | "wlte";
export type TrafficOp = "read" | "write" | "delete" | "socket";

export type TrafficSide = {
  requests: number;
  bytesSent: number;
  bytesReceived: number;
};

export type TrafficSlice = TrafficSide & {
  peer: TrafficPeer;
  name: string;
  operation: TrafficOp;
};

export type TrafficWindow = {
  elapsedMs: number;
  measured: TrafficSide;
  perHour: TrafficSide;
  perDay: TrafficSide;
  perMonth: TrafficSide;
  hourlyIsForecast: boolean;
  dailyIsForecast: boolean;
  monthlyIsForecast: boolean;
};

export type TrafficSnapshot = {
  processStartedAt: string;
  resetAt: string;
  supabase: TrafficWindow;
  wlte: TrafficWindow;
  slices: TrafficSlice[];
};

const empty = (): TrafficSide => ({ requests: 0, bytesSent: 0, bytesReceived: 0 });

type State = {
  processStartedAt: string;
  resetAt: string;
  supabase: TrafficSide;
  wlte: TrafficSide;
  slices: Map<string, TrafficSlice>;
};

const globalTraffic = globalThis as unknown as { __pikudTraffic?: State };

function bucket(): State {
  if (!globalTraffic.__pikudTraffic) {
    const now = new Date().toISOString();
    globalTraffic.__pikudTraffic = {
      processStartedAt: now,
      resetAt: now,
      supabase: empty(),
      wlte: empty(),
      slices: new Map(),
    };
  }
  return globalTraffic.__pikudTraffic;
}

export function byteSize(value: string | undefined | null): number {
  return value ? Buffer.byteLength(value) : 0;
}

export function classifyRequest(peer: TrafficPeer, url: string, method: string | undefined): { name: string; operation: TrafficOp } {
  const upper = (method ?? "GET").toUpperCase();
  const operation: TrafficOp = upper === "DELETE" ? "delete" : upper === "GET" || upper === "HEAD" ? "read" : "write";
  let path = url;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    path = url.split("?")[0] ?? url;
  }
  if (peer === "supabase") {
    const rest = path.split("/rest/v1/")[1];
    const name = decodeURIComponent((rest ?? path).split("/").filter(Boolean)[0] ?? "other");
    return { name, operation };
  }
  if (path.includes("/auth/token")) return { name: "token", operation: "write" };
  if (path.includes("/commands")) return { name: "command", operation: "write" };
  if (path.includes("/devices")) return { name: "device", operation };
  if (path.includes("/ws")) return { name: "socket", operation: "socket" };
  return { name: "other", operation };
}

/** Counts one exchange in this process. Nothing here is written to the database. */
export function recordTraffic(
  peer: TrafficPeer,
  sample: { bytesSent?: number; bytesReceived?: number; name?: string; operation?: TrafficOp },
) {
  const current = bucket();
  const side = current[peer];
  side.requests += 1;
  side.bytesSent += sample.bytesSent ?? 0;
  side.bytesReceived += sample.bytesReceived ?? 0;
  if (!sample.name || !sample.operation) return;
  const key = `${peer}:${sample.name}:${sample.operation}`;
  const slice = current.slices.get(key) ?? {
    peer,
    name: sample.name,
    operation: sample.operation,
    requests: 0,
    bytesSent: 0,
    bytesReceived: 0,
  };
  slice.requests += 1;
  slice.bytesSent += sample.bytesSent ?? 0;
  slice.bytesReceived += sample.bytesReceived ?? 0;
  current.slices.set(key, slice);
}

function scale(side: TrafficSide, factor: number): TrafficSide {
  return {
    requests: side.requests * factor,
    bytesSent: side.bytesSent * factor,
    bytesReceived: side.bytesReceived * factor,
  };
}

function windowFor(side: TrafficSide, elapsedMs: number): TrafficWindow {
  const hours = Math.max(elapsedMs, 1) / 3_600_000;
  const perHour = scale(side, 1 / hours);
  return {
    elapsedMs,
    measured: { ...side },
    perHour,
    perDay: scale(perHour, 24),
    perMonth: scale(perHour, 24 * 30),
    hourlyIsForecast: elapsedMs < 3_600_000,
    dailyIsForecast: elapsedMs < 24 * 3_600_000,
    monthlyIsForecast: elapsedMs < 30 * 24 * 3_600_000,
  };
}

export function trafficSnapshot(now = Date.now()): TrafficSnapshot {
  const current = bucket();
  const elapsedMs = Math.max(0, now - Date.parse(current.resetAt));
  return {
    processStartedAt: current.processStartedAt,
    resetAt: current.resetAt,
    supabase: windowFor(current.supabase, elapsedMs),
    wlte: windowFor(current.wlte, elapsedMs),
    slices: [...current.slices.values()].sort((left, right) => right.requests - left.requests || left.name.localeCompare(right.name)),
  };
}

export function resetTraffic() {
  const current = bucket();
  current.resetAt = new Date().toISOString();
  current.supabase = empty();
  current.wlte = empty();
  current.slices = new Map();
}

export async function measuredFetch(peer: TrafficPeer, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (typeof input === "object" && !(input instanceof URL) ? input.method : undefined);
  const kind = classifyRequest(peer, url, method);
  const body = typeof init?.body === "string" ? init.body : null;
  const sent = byteSize(url) + byteSize(body);
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    recordTraffic(peer, { bytesSent: sent, bytesReceived: 0, ...kind });
    throw error;
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared >= 0) {
    recordTraffic(peer, { bytesSent: sent, bytesReceived: declared, ...kind });
    return response;
  }
  const copy = response.clone();
  const received = (await copy.arrayBuffer()).byteLength;
  recordTraffic(peer, { bytesSent: sent, bytesReceived: received, ...kind });
  return response;
}

export type ScanReads = {
  tenants: number;
  callerNumbers: number;
  devices: number;
  backups: number;
  total: number;
};

/**
 * Steady background reads of the tenant scan, not the 15-second due check and not an open page.
 * Before: both scans ran on every 15-second tick, and each tenant list also loaded every phone.
 * After: each scan runs once a minute and asks only for tenant ids.
 */
export function backgroundScanReads(input: { tenants: number; shellies: number; before: boolean }): ScanReads {
  const ticks = input.before ? 240 : 60;
  const tenantLists = input.before ? ticks * 2 : ticks * 2;
  const callerNumbers = input.before ? ticks * 2 : 0;
  const devices = ticks * input.tenants;
  const backups = ticks * input.shellies;
  return {
    tenants: tenantLists,
    callerNumbers,
    devices,
    backups,
    total: tenantLists + callerNumbers + devices + backups,
  };
}
