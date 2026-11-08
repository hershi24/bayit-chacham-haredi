import type { Connectivity, RelayAction } from "@/lib/types";

export type DeviceSnapshot = {
  deviceId: string;
  name: string | null;
  deviceType: string | null;
  connectivity: Connectivity;
  relayOn: boolean | null;
  stateUpdatedAt: string | null;
  sensorSummary: string | null;
};

export type CommandSnapshot = {
  code: string;
  message: string;
  requestId: string | null;
  commandId: string | null;
  deviceId: string | null;
  relayIndex: number | null;
  action: RelayAction | null;
  status: "SUCCESS" | "FAILED" | "SENT" | "TIMEOUT" | "UNKNOWN";
  createdAt: string | null;
};

export type NormalizedEvent =
  | {
      type: "state";
      deviceId: string;
      relayOn: boolean | null;
      stateUpdatedAt: string | null;
    }
  | {
      type: "connectivity";
      deviceId: string;
      connectivity: "ONLINE" | "OFFLINE";
      stateUpdatedAt: string | null;
      topic: string;
    };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNewerIso(previous: string | null, incoming: string | null): boolean {
  if (!incoming) return false;
  const next = Date.parse(incoming);
  if (Number.isNaN(next)) return false;
  if (!previous) return true;
  const prev = Date.parse(previous);
  if (Number.isNaN(prev)) return true;
  return next >= prev;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function connectivityOf(status: unknown): Connectivity {
  if (status === "ONLINE") return "ONLINE";
  if (status === "OFFLINE") return "OFFLINE";
  return "UNKNOWN";
}

export function relayOnFrom(relays: unknown): boolean | null {
  if (!Array.isArray(relays)) return null;
  const records = relays.filter(isRecord);
  const relay = records.find((item) => item.index === 1) ?? records[0];
  if (!relay || typeof relay.on !== "boolean") return null;
  return relay.on;
}

export function sensorSummary(sensors: unknown): string | null {
  if (!Array.isArray(sensors) || sensors.length === 0) return null;
  const parts = sensors.filter(isRecord).map((sensor) => {
    const type = sensor.type === "TEMP" ? "טמפרטורה" : text(sensor.type) ?? "חיישן";
    const status =
      sensor.status === "OFFLINE" ? "לא מחובר" : sensor.status === "ONLINE" ? "מחובר" : text(sensor.status);
    const unit = text(sensor.unit) ?? "";
    const value = typeof sensor.value === "number" ? ` ${sensor.value}${unit}` : "";
    return status ? `${type}: ${status}${value}` : `${type}${value}`;
  });
  return parts.length ? parts.join(" · ") : null;
}

function dataOf(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  return isRecord(body.data) ? body.data : body;
}

export function parseDeviceResponse(body: unknown, fallbackDeviceId?: string): DeviceSnapshot {
  const data = dataOf(body);
  const peripherals = isRecord(data.peripherals) ? data.peripherals : {};
  const deviceId = text(data.deviceId) ?? fallbackDeviceId ?? "";
  return {
    deviceId,
    name: text(data.name),
    deviceType: text(data.deviceType),
    connectivity: connectivityOf(data.status),
    relayOn: relayOnFrom(peripherals.relays),
    stateUpdatedAt: text(data.stateUpdatedAt),
    sensorSummary: sensorSummary(peripherals.sensors),
  };
}

function commandStatus(value: unknown): CommandSnapshot["status"] {
  if (value === "SUCCESS" || value === "FAILED" || value === "SENT" || value === "TIMEOUT") return value;
  return "UNKNOWN";
}

function actionOf(value: unknown): RelayAction | null {
  return value === "ON" || value === "OFF" ? value : null;
}

export function parseCommandResponse(body: unknown): CommandSnapshot {
  const root = isRecord(body) ? body : {};
  const data = dataOf(body);
  const command = isRecord(data.command) ? data.command : data;
  const params = isRecord(command.params) ? command.params : {};
  const relays = Array.isArray(params.relays) ? params.relays.filter(isRecord) : [];
  const first = relays[0];
  return {
    code: text(root.code) ?? "UNKNOWN",
    message: text(root.message) ?? "",
    requestId: text(root.requestId),
    commandId: text(command.id) ?? text(data.id),
    deviceId: text(command.deviceId) ?? text(data.deviceId),
    relayIndex:
      typeof command.relayIndex === "number"
        ? command.relayIndex
        : typeof first?.index === "number"
          ? first.index
          : null,
    action: actionOf(command.action) ?? actionOf(first?.action),
    status: commandStatus(command.status),
    createdAt: text(command.createdAt) ?? text(data.createdAt),
  };
}

export function parseWsEvent(payload: unknown): NormalizedEvent | null {
  if (!isRecord(payload)) return null;
  if (payload.type === "reply" || payload.type === "request") return null;
  const topic = text(payload.topic);
  const data = isRecord(payload.data) ? payload.data : {};
  const deviceId = text(data.deviceId);
  if (!topic || !deviceId) return null;
  const peripherals = isRecord(data.peripherals) ? data.peripherals : {};
  const stateUpdatedAt = text(data.stateUpdatedAt) ?? text(data.occurredAt);

  if (topic === "device.state.changed") {
    return {
      type: "state",
      deviceId,
      relayOn: relayOnFrom(peripherals.relays),
      stateUpdatedAt,
    };
  }

  if (topic === "device.connection.online" || topic === "device.power.restored") {
    return { type: "connectivity", deviceId, connectivity: "ONLINE", stateUpdatedAt, topic };
  }

  if (topic === "device.connection.offline" || topic === "device.power.lost") {
    return { type: "connectivity", deviceId, connectivity: "OFFLINE", stateUpdatedAt, topic };
  }

  return null;
}

export function isWsReply(payload: unknown): payload is Record<string, unknown> {
  return isRecord(payload) && payload.type === "reply" && typeof payload.requestId === "string";
}

export function wsReplyOk(code: string | undefined): boolean {
  return code === "SUCCESS" || code === "COMMAND_ACCEPTED";
}

export function sessionPing(requestId: string) {
  return {
    type: "request" as const,
    requestId,
    topic: "session.ping" as const,
    data: {},
  };
}

export function deviceStateGetRequest(requestId: string, deviceId: string) {
  return {
    type: "request" as const,
    requestId,
    topic: "device.state.get" as const,
    data: { deviceId },
  };
}

export function deviceRelaySetRequest(requestId: string, deviceId: string, action: RelayAction, idempotencyKey: string) {
  return {
    type: "request" as const,
    requestId,
    topic: "device.operation.execute" as const,
    data: {
      deviceId,
      idempotencyKey,
      operation: {
        name: "device.relay.set",
        params: {
          relays: [{ index: 1, action }],
        },
      },
    },
  };
}

/** Optional live state bundled with a relay-command WebSocket reply. */
export function parseCommandReplyState(body: unknown): DeviceSnapshot | null {
  if (!isRecord(body)) return null;
  const data = dataOf(body);
  const state = isRecord(data.state) ? data.state : null;
  if (!state) return null;
  const deviceId = text(state.deviceId) ?? text(data.deviceId);
  if (!deviceId) return null;
  return parseDeviceResponse({ data: state }, deviceId);
}

export function codeOf(body: unknown): string | undefined {
  return isRecord(body) && typeof body.code === "string" ? body.code : undefined;
}

export function messageOf(body: unknown): string | undefined {
  return isRecord(body) && typeof body.message === "string" ? body.message : undefined;
}
