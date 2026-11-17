import assert from "node:assert/strict";
import test from "node:test";
import { mergeBoardDevices } from "../lib/board-merge";
import type { DeviceView } from "../lib/types";

function device(patch: Partial<DeviceView> & Pick<DeviceView, "deviceId" | "relayOn" | "stateUpdatedAt">): DeviceView {
  return {
    name: patch.deviceId,
    tenantId: "t",
    tenantName: "לקוח",
    connectivity: "ONLINE",
    lastError: null,
    deviceType: null,
    sensorSummary: null,
    icon: null,
    frozen: false,
    sortOrder: 0,
    vendor: "shelly",
    kind: "socket",
    externalId: null,
    channel: 0,
    ...patch,
  };
}

test("a late board snapshot does not undo a newer relay", () => {
  const current = [device({ deviceId: "a", relayOn: true, stateUpdatedAt: "2026-11-17T16:00:05.000Z" })];
  const incoming = [device({ deviceId: "a", relayOn: false, stateUpdatedAt: "2026-11-17T16:00:01.000Z" })];
  const merged = mergeBoardDevices(current, incoming, new Map());
  assert.equal(merged[0]?.relayOn, true);
  assert.equal(merged[0]?.stateUpdatedAt, "2026-11-17T16:00:05.000Z");
});

test("a pending command keeps its relay until the board agrees", () => {
  const current = [device({ deviceId: "a", relayOn: true, stateUpdatedAt: "2026-11-17T16:00:05.000Z" })];
  const incoming = [device({ deviceId: "a", relayOn: false, stateUpdatedAt: "2026-11-17T16:00:09.000Z" })];
  const merged = mergeBoardDevices(current, incoming, new Map([["a", true]]));
  assert.equal(merged[0]?.relayOn, true);
});

test("a newer snapshot is kept once nothing is pending", () => {
  const current = [device({ deviceId: "a", relayOn: true, stateUpdatedAt: "2026-11-17T16:00:05.000Z" })];
  const incoming = [device({ deviceId: "a", relayOn: false, stateUpdatedAt: "2026-11-17T16:00:09.000Z", name: "דוד" })];
  const merged = mergeBoardDevices(current, incoming, new Map());
  assert.equal(merged[0]?.relayOn, false);
  assert.equal(merged[0]?.name, "דוד");
});
