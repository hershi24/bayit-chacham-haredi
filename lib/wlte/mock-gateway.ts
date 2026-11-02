import { randomUUID } from "node:crypto";
import type { RelayAction } from "@/lib/types";
import { WlteError } from "@/lib/wlte/errors";

export type MockSeed = {
  deviceId: string;
  relayOn: boolean;
  online: boolean;
  name?: string;
};

type Device = {
  deviceId: string;
  name: string;
  relayOn: boolean;
  online: boolean;
  stateUpdatedAt: string;
};

export class MockGateway {
  private readonly devices = new Map<string, Device>();
  private readonly idempotency = new Map<string, { fingerprint: string; body: unknown }>();
  private readonly listeners = new Set<(payload: unknown) => void>();

  constructor(
    seeds: MockSeed[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const seed of seeds) this.ensure(seed);
  }

  ensure(seed: MockSeed) {
    if (this.devices.has(seed.deviceId)) return;
    this.devices.set(seed.deviceId, {
      deviceId: seed.deviceId,
      name: seed.name ?? seed.deviceId,
      relayOn: seed.relayOn,
      online: seed.online,
      stateUpdatedAt: this.now().toISOString(),
    });
  }

  remove(deviceId: string) {
    this.devices.delete(deviceId);
  }

  onEvent(listener: (payload: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  deviceBody(deviceId: string): unknown {
    const device = this.devices.get(deviceId);
    if (!device) throw new WlteError("DEVICE_NOT_FOUND", 404);
    return {
      code: "SUCCESS",
      message: "OK.",
      requestId: randomUUID(),
      data: {
        deviceId: device.deviceId,
        name: device.name,
        deviceType: "SC1_T",
        status: device.online ? "ONLINE" : "OFFLINE",
        peripherals: {
          relays: [{ index: 1, on: device.relayOn }],
          sensors: [{ index: 1, type: "TEMP", unit: "°C", status: "OFFLINE" }],
        },
        stateUpdatedAt: device.stateUpdatedAt,
      },
    };
  }

  command(deviceId: string, action: RelayAction, key: string): unknown {
    if (!key) throw new WlteError("INVALID_REQUEST", 400);
    const fingerprint = `${deviceId}|1|${action}`;
    const previous = this.idempotency.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new WlteError("IDEMPOTENCY_CONFLICT", 409);
      return previous.body;
    }

    const device = this.devices.get(deviceId);
    if (!device) throw new WlteError("DEVICE_NOT_FOUND", 404);
    if (!device.online) throw new WlteError("DEVICE_OFFLINE", 422);

    device.relayOn = action === "ON";
    device.stateUpdatedAt = this.now().toISOString();
    const body = {
      code: "COMMAND_ACCEPTED",
      message: "Command accepted.",
      requestId: randomUUID(),
      data: {
        id: `cmd_${randomUUID()}`,
        deviceId,
        relayIndex: 1,
        action,
        status: "SUCCESS",
        createdAt: device.stateUpdatedAt,
      },
    };
    this.idempotency.set(key, { fingerprint, body });
    return body;
  }

  simulate(deviceId: string, patch: { relayOn?: boolean; online?: boolean }) {
    const device = this.devices.get(deviceId);
    if (!device) throw new WlteError("DEVICE_NOT_FOUND", 404);
    const wasOnline = device.online;
    if (typeof patch.online === "boolean") device.online = patch.online;
    if (typeof patch.relayOn === "boolean") device.relayOn = patch.relayOn;
    device.stateUpdatedAt = this.now().toISOString();

    if (wasOnline !== device.online) {
      this.emit({
        topic: device.online ? "device.connection.online" : "device.connection.offline",
        data: {
          deviceId,
          occurredAt: device.stateUpdatedAt,
          stateUpdatedAt: device.stateUpdatedAt,
        },
      });
    }

    this.emit({
      topic: "device.state.changed",
      data: {
        deviceId,
        occurredAt: device.stateUpdatedAt,
        changes: [{ type: "relay", indexes: [1] }],
        peripherals: { relays: [{ index: 1, on: device.relayOn }] },
        stateUpdatedAt: device.stateUpdatedAt,
      },
    });
  }

  private emit(payload: unknown) {
    for (const listener of this.listeners) listener(payload);
  }
}
