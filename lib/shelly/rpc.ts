import { isRecord } from "@/lib/wlte/parse";
import type { ShellyChannel } from "@/lib/shelly/ids";

export type ShellyRpcFrame = {
  id?: number | string;
  src?: string;
  dst?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export function parseShellyFrame(raw: string): ShellyRpcFrame | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    return parsed as ShellyRpcFrame;
  } catch {
    return null;
  }
}

export function shellyCall(id: number, method: string, params?: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    src: "pikud",
    method,
    ...(params ? { params } : {}),
  });
}

export function switchSetCall(id: number, channel: ShellyChannel, on: boolean): string {
  return shellyCall(id, "Switch.Set", { id: channel, on });
}

export function getDeviceInfoCall(id: number): string {
  return shellyCall(id, "Shelly.GetDeviceInfo");
}

export function getStatusCall(id: number): string {
  return shellyCall(id, "Shelly.GetStatus");
}

export function readDeviceInfoId(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const id = result.id;
  return typeof id === "string" && id.trim() ? id.trim().toLowerCase() : null;
}

export type ChannelState = { channel: ShellyChannel; on: boolean | null };

/** Extract switch:0/1/2 on-state from GetStatus / NotifyStatus params. */
export function channelStatesFromStatus(payload: unknown): ChannelState[] {
  const root = isRecord(payload) ? payload : null;
  if (!root) return [];
  const bag = isRecord(root.params) ? root.params : root;
  const out: ChannelState[] = [];
  for (const channel of [0, 1, 2] as ShellyChannel[]) {
    const key = `switch:${channel}`;
    const row = bag[key];
    if (!isRecord(row)) continue;
    out.push({ channel, on: typeof row.output === "boolean" ? row.output : typeof row.on === "boolean" ? row.on : null });
  }
  return out;
}
