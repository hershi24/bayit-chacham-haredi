export type TrafficPeer = "supabase" | "wlte";

export type TrafficSide = {
  requests: number;
  bytesSent: number;
  bytesReceived: number;
};

export type TrafficSnapshot = {
  startedAt: string;
  supabase: TrafficSide;
  wlte: TrafficSide;
};

const empty = (): TrafficSide => ({ requests: 0, bytesSent: 0, bytesReceived: 0 });

const globalTraffic = globalThis as unknown as {
  __pikudTraffic?: { startedAt: string; supabase: TrafficSide; wlte: TrafficSide };
};

function bucket() {
  if (!globalTraffic.__pikudTraffic) {
    globalTraffic.__pikudTraffic = { startedAt: new Date().toISOString(), supabase: empty(), wlte: empty() };
  }
  return globalTraffic.__pikudTraffic;
}

export function byteSize(value: string | undefined | null): number {
  return value ? Buffer.byteLength(value) : 0;
}

/** Counts one exchange. The numbers stay in this process and are never written to the database. */
export function recordTraffic(peer: TrafficPeer, sample: { bytesSent?: number; bytesReceived?: number }) {
  const side = bucket()[peer];
  side.requests += 1;
  side.bytesSent += sample.bytesSent ?? 0;
  side.bytesReceived += sample.bytesReceived ?? 0;
}

export function trafficSnapshot(): TrafficSnapshot {
  const current = bucket();
  return {
    startedAt: current.startedAt,
    supabase: { ...current.supabase },
    wlte: { ...current.wlte },
  };
}

export function resetTraffic() {
  globalTraffic.__pikudTraffic = { startedAt: new Date().toISOString(), supabase: empty(), wlte: empty() };
}

export async function measuredFetch(peer: TrafficPeer, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = typeof init?.body === "string" ? init.body : null;
  const sent = byteSize(url) + byteSize(body);
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    recordTraffic(peer, { bytesSent: sent, bytesReceived: 0 });
    throw error;
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared >= 0) {
    recordTraffic(peer, { bytesSent: sent, bytesReceived: declared });
    return response;
  }
  const copy = response.clone();
  const received = (await copy.arrayBuffer()).byteLength;
  recordTraffic(peer, { bytesSent: sent, bytesReceived: received });
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
