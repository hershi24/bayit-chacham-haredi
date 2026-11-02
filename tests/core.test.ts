import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessDevice, normalizePhone, phonesMatch, resolveDevice } from "../lib/access";
import { speechFor, yemotBody } from "../lib/ivr/speech";
import { MockGateway } from "../lib/wlte/mock-gateway";
import {
  isNewerIso,
  parseCommandResponse,
  parseDeviceResponse,
  parseWsEvent,
} from "../lib/wlte/parse";
import { REQUIRED_SCOPES, missingScopes, tokenNeedsRefresh } from "../lib/wlte/policy";
import { retryDecision, runIdempotent } from "../lib/wlte/retry";
import { TokenManager } from "../lib/wlte/token-manager";
import { WlteError } from "../lib/wlte/errors";

const deviceSample = {
  code: "SUCCESS",
  message: "OK.",
  requestId: "8a7c2108-9878-4f4b-886d-ef74f59079c4",
  data: {
    deviceId: "rct063285302",
    name: "אולם",
    deviceType: "SC1_T",
    status: "ONLINE",
    peripherals: {
      relays: [{ index: 1, on: false }],
      sensors: [{ index: 1, type: "TEMP", unit: "°C", status: "OFFLINE" }],
    },
    stateUpdatedAt: "2026-11-02T12:08:31Z",
  },
};

const commandSample = {
  code: "COMMAND_ACCEPTED",
  message: "Command accepted.",
  requestId: "392f5661-a347-46ef-97c8-74cba790395e",
  data: {
    id: "cmd_58741247-02e4-4e94-8503-e70f44ec9c29",
    deviceId: "rct063285302",
    relayIndex: 1,
    action: "OFF",
    status: "SUCCESS",
    createdAt: "2026-11-02T12:07:44Z",
  },
};

describe("WLTE payloads", () => {
  it("reads relay 1 and motor connectivity from a device query", () => {
    const snapshot = parseDeviceResponse(deviceSample);
    assert.equal(snapshot.deviceId, "rct063285302");
    assert.equal(snapshot.connectivity, "ONLINE");
    assert.equal(snapshot.relayOn, false);
    assert.equal(snapshot.deviceType, "SC1_T");
    assert.match(snapshot.sensorSummary ?? "", /טמפרטורה/);
  });

  it("reads the compatibility command response", () => {
    const command = parseCommandResponse(commandSample);
    assert.equal(command.code, "COMMAND_ACCEPTED");
    assert.equal(command.status, "SUCCESS");
    assert.equal(command.action, "OFF");
    assert.equal(command.relayIndex, 1);
    assert.equal(command.commandId, "cmd_58741247-02e4-4e94-8503-e70f44ec9c29");
  });

  it("reads the batch command response", () => {
    const command = parseCommandResponse({
      code: "COMMAND_ACCEPTED",
      data: {
        command: {
          id: "cmd_batch",
          deviceId: "rct063285302",
          status: "SENT",
          params: { relays: [{ index: 1, action: "ON" }] },
          createdAt: "2026-11-02T12:00:00Z",
        },
      },
    });
    assert.equal(command.status, "SENT");
    assert.equal(command.action, "ON");
    assert.equal(command.commandId, "cmd_batch");
  });

  it("reads relay changes from both websocket envelopes", () => {
    const simple = parseWsEvent({
      topic: "device.state.changed",
      data: { deviceId: "rct063285302", peripherals: { relays: [{ index: 1, on: true }] } },
    });
    assert.equal(simple?.type, "state");
    if (simple?.type === "state") assert.equal(simple.relayOn, true);

    const official = parseWsEvent({
      type: "event",
      topic: "device.state.changed",
      data: {
        deviceId: "abc123456789",
        occurredAt: "2026-07-18T08:30:00Z",
        peripherals: { relays: [{ index: 1, on: false }] },
        stateUpdatedAt: "2026-07-18T08:30:00Z",
      },
    });
    assert.equal(official?.type, "state");
    const offline = parseWsEvent({
      topic: "device.connection.offline",
      data: { deviceId: "rct063285302", occurredAt: "2026-11-02T12:09:00Z" },
    });
    assert.deepEqual(offline, {
      type: "connectivity",
      deviceId: "rct063285302",
      connectivity: "OFFLINE",
      stateUpdatedAt: "2026-11-02T12:09:00Z",
      topic: "device.connection.offline",
    });
  });

  it("ignores an older device snapshot", () => {
    assert.equal(isNewerIso("2026-11-02T12:08:31Z", "2026-11-02T12:08:30Z"), false);
    assert.equal(isNewerIso("2026-11-02T12:08:31Z", "2026-11-02T12:08:31Z"), true);
  });
});

describe("token and retries", () => {
  it("refreshes at 50 minutes and near hard expiry", () => {
    const issuedAt = 0;
    const expiresAt = 3600 * 1000;
    assert.equal(tokenNeedsRefresh({ issuedAt, expiresAt }, 49 * 60 * 1000), false);
    assert.equal(tokenNeedsRefresh({ issuedAt, expiresAt }, 50 * 60 * 1000), true);
    assert.equal(tokenNeedsRefresh({ issuedAt, expiresAt: 60_000 }, 0), true);
    assert.equal(tokenNeedsRefresh(null, 0), true);
  });

  it("issues one token for concurrent callers and another after 50 minutes", async () => {
    let now = 1_000;
    let calls = 0;
    const manager = new TokenManager(async () => {
      calls += 1;
      return {
        accessToken: `token-${calls}`,
        expiresIn: 3600,
        scopes: [...REQUIRED_SCOPES],
        clientId: "cli",
      };
    }, () => now);

    const [first, second] = await Promise.all([manager.get(), manager.get()]);
    assert.equal(calls, 1);
    assert.equal(first.accessToken, second.accessToken);
    now += 49 * 60 * 1000;
    assert.equal((await manager.get()).accessToken, "token-1");
    now += 60 * 1000;
    assert.equal((await manager.get()).accessToken, "token-2");
    assert.deepEqual(manager.status().missingScopes, []);
  });

  it("reuses the same attempt after a lost response and refreshes once on 401", async () => {
    assert.equal(retryDecision({ networkError: true, refreshed: false, retries: 0 }), "retry-same-key");
    assert.equal(retryDecision({ status: 401, networkError: false, refreshed: false, retries: 0 }), "refresh-then-retry");
    assert.equal(retryDecision({ status: 401, networkError: false, refreshed: true, retries: 0 }), "return");
    assert.equal(retryDecision({ status: 422, code: "DEVICE_OFFLINE", networkError: false, refreshed: false, retries: 0 }), "return");

    const keys: string[] = [];
    let tries = 0;
    let refreshed = 0;
    const key = "6c1d8c2e-1b2a-4c3d-8e9f-001122334455";
    const result = await runIdempotent(
      async () => {
        keys.push(key);
        tries += 1;
        if (tries === 1) return { status: 401, code: "AUTH_EXPIRED" };
        return { status: 200, body: { code: "COMMAND_ACCEPTED" } };
      },
      async () => {
        refreshed += 1;
      },
      async () => undefined,
    );
    assert.equal(refreshed, 1);
    assert.deepEqual(keys, [key, key]);
    assert.equal(result.status, 200);
  });

  it("reports missing scopes", () => {
    assert.deepEqual(missingScopes(["device:read"]), ["device:control", "device:manage", "device:config"]);
  });
});

describe("IVR and tenants", () => {
  it("speaks the phrases from the spec", () => {
    assert.equal(speechFor({ kind: "on-success" }), "השקע הופעל בהצלחה");
    assert.equal(speechFor({ kind: "status", relayOn: false }), "השקע כבוי כעת");
    assert.equal(speechFor({ kind: "status", relayOn: true }), "השקע פועל כעת");
    assert.equal(yemotBody("השקע הופעל בהצלחה"), "id_list_message=t-השקע הופעל בהצלחה&go_to_folder=hangup\n");
  });

  it("matches Israeli numbers and isolates tenants", () => {
    assert.equal(normalizePhone("+972-3-555-1001"), "035551001");
    assert.equal(phonesMatch("035551001", "97235551001"), true);
    const devices = [
      { deviceId: "a", phone: "035551001" },
      { deviceId: "b", phone: "035551001" },
      { deviceId: "c", phone: "035551002" },
    ];
    const byId = resolveDevice(devices, { deviceId: "c" });
    assert.equal(byId.ok, true);
    if (byId.ok) assert.equal(byId.device.deviceId, "c");
    const many = resolveDevice(devices, { phone: "035551001" });
    assert.equal(many.ok, false);
    if (!many.ok) assert.equal(many.reason, "ambiguous");
    const byPhone = resolveDevice(devices, { phone: "035551002" });
    assert.equal(byPhone.ok, true);
    if (byPhone.ok) assert.equal(byPhone.device.deviceId, "c");
    assert.equal(canAccessDevice({ role: "operator", tenantId: "ten_a" }, "ten_b"), false);
    assert.equal(canAccessDevice({ role: "admin", tenantId: null }, "ten_b"), true);
  });
});

describe("mock gateway", () => {
  it("replays an idempotency key and rejects a conflicting one", () => {
    const gateway = new MockGateway([{ deviceId: "rct063285302", relayOn: false, online: true }]);
    const first = parseCommandResponse(gateway.command("rct063285302", "ON", "key-1"));
    const second = parseCommandResponse(gateway.command("rct063285302", "ON", "key-1"));
    assert.equal(first.commandId, second.commandId);
    assert.equal(parseDeviceResponse(gateway.deviceBody("rct063285302")).relayOn, true);
    assert.throws(() => gateway.command("rct063285302", "OFF", "key-1"), (error: unknown) => {
      return error instanceof WlteError && error.code === "IDEMPOTENCY_CONFLICT";
    });
    gateway.simulate("rct063285302", { online: false });
    assert.throws(() => gateway.command("rct063285302", "OFF", "key-2"), (error: unknown) => {
      return error instanceof WlteError && error.code === "DEVICE_OFFLINE";
    });
  });
});
