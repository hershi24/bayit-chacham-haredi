import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../lib/http-error";
import { createDevice, createTenant, deleteDevice, deleteTenant, getDevice, setDeviceFrozen, updateDeviceState } from "../lib/store";
import { getBridge } from "../lib/wlte/bridge";
import { WlteError } from "../lib/wlte/errors";
import { createLiveGateway } from "../lib/wlte/live";
import { TokenManager } from "../lib/wlte/token-manager";
import type { RelayAction } from "../lib/types";

const config = {
  baseUrl: "https://openapi.example",
  clientId: "cli",
  clientSecret: "sec",
  mode: "live" as const,
  relayStyle: "indexed" as const,
  ivrToken: "dev-ivr-7f3a",
  ivrTokenIsDefault: true,
};

type RelayCall = { auth: string; key: string; body: string; url: string };

function commandBody(action: RelayAction) {
  return {
    code: "COMMAND_ACCEPTED",
    message: "Command accepted.",
    requestId: "req",
    data: { id: "cmd", action, status: "SUCCESS", relayIndex: 1 },
  };
}

async function withRelay(options: {
  reject: { status: number; code: string };
  then?: { status: number; code: string };
  run: (input: { issued: () => number; relays: RelayCall[]; gateway: ReturnType<typeof createLiveGateway> }) => Promise<void>;
}) {
  const previous = global.fetch;
  const relays: RelayCall[] = [];
  let issued = 0;
  const manager = new TokenManager(async () => {
    issued += 1;
    return {
      accessToken: `token-${issued}`,
      expiresIn: 3600,
      scopes: ["device:read", "device:control"],
      clientId: "cli",
    };
  });
  await manager.get();
  const seen = new Map<string, { status: number; body: unknown }>();
  global.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const key = headers.get("idempotency-key") ?? "";
    const body = typeof init?.body === "string" ? init.body : "";
    const auth = headers.get("authorization") ?? "";
    relays.push({ auth, key, body, url });
    const replay = key ? seen.get(key) : undefined;
    if (replay) return Response.json(replay.body, { status: replay.status });
    const stored = relays.length === 1 ? options.reject : (options.then ?? options.reject);
    const payload = { code: stored.code, message: stored.code };
    if (key) seen.set(key, { status: stored.status, body: payload });
    if (stored.status >= 400) return Response.json(payload, { status: stored.status });
    const action: RelayAction = body.includes('"OFF"') ? "OFF" : "ON";
    return Response.json(commandBody(action), { status: stored.status });
  };
  const gateway = createLiveGateway(config, manager);
  try {
    await options.run({ issued: () => issued, relays, gateway });
  } finally {
    global.fetch = previous;
  }
}

test("refreshes an expired token and sends the same ON once more", async () => {
  await withRelay({
    reject: { status: 401, code: "AUTH_EXPIRED" },
    then: { status: 202, code: "COMMAND_ACCEPTED" },
    run: async ({ issued, relays, gateway }) => {
      const result = await gateway.command("rct-token-retry", "ON", "key-on");
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.action, "ON");
      assert.equal(issued(), 2);
      assert.equal(relays.length, 2);
      assert.equal(relays[0]?.auth, "Bearer token-1");
      assert.equal(relays[1]?.auth, "Bearer token-2");
      assert.equal(relays[0]?.body, JSON.stringify({ action: "ON" }));
      assert.equal(relays[1]?.body, relays[0]?.body);
      assert.equal(relays[0]?.url.includes("/relays/1/commands"), true);
      assert.notEqual(relays[0]?.key, relays[1]?.key);
      assert.equal(relays[0]?.key, "key-on");
    },
  });
});

test("refreshes a rejected token and sends the same OFF once more", async () => {
  await withRelay({
    reject: { status: 403, code: "AUTH_EXPIRED" },
    then: { status: 202, code: "COMMAND_ACCEPTED" },
    run: async ({ issued, relays, gateway }) => {
      const result = await gateway.command("rct-token-retry", "OFF", "key-off");
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.action, "OFF");
      assert.equal(issued(), 2);
      assert.equal(relays.length, 2);
      assert.equal(relays[0]?.auth, "Bearer token-1");
      assert.equal(relays[1]?.auth, "Bearer token-2");
      assert.equal(relays[0]?.body, JSON.stringify({ action: "OFF" }));
      assert.equal(relays[1]?.body, relays[0]?.body);
      assert.notEqual(relays[0]?.key, relays[1]?.key);
    },
  });
});

test("a second auth failure after refresh stays a failure", async () => {
  await withRelay({
    reject: { status: 401, code: "AUTH_EXPIRED" },
    run: async ({ issued, relays, gateway }) => {
      await assert.rejects(
        () => gateway.command("rct-token-retry", "ON", "key-stuck"),
        (error: unknown) => error instanceof WlteError && error.code === "AUTH_EXPIRED",
      );
      assert.equal(issued(), 2);
      assert.equal(relays.length, 2);
      assert.equal(relays[1]?.auth, "Bearer token-2");
    },
  });
});

test("an offline relay after a token refresh is not refreshed again", async () => {
  await withRelay({
    reject: { status: 401, code: "AUTH_EXPIRED" },
    then: { status: 422, code: "DEVICE_OFFLINE" },
    run: async ({ issued, relays, gateway }) => {
      await assert.rejects(
        () => gateway.command("rct-token-retry", "ON", "key-offline"),
        (error: unknown) => error instanceof WlteError && error.code === "DEVICE_OFFLINE",
      );
      assert.equal(issued(), 2);
      assert.equal(relays.length, 2);
    },
  });
});

test("a frozen socket is not retried into a relay command", async () => {
  const tenant = await createTenant({ name: "לקוח טוקן", phone: "0540001991" });
  const deviceId = "rcttokenretry1";
  try {
    await createDevice({ deviceId, name: "שקע מוקפא", tenantId: tenant.id });
    await updateDeviceState(deviceId, {
      connectivity: "ONLINE",
      relayOn: false,
      stateUpdatedAt: new Date().toISOString(),
      lastError: null,
    });
    await setDeviceFrozen(deviceId, true);
    await assert.rejects(
      () => getBridge().command({ deviceId, action: "ON", source: "ivr", actor: "טלפון" }),
      (error: unknown) => error instanceof HttpError && error.status === 403 && error.message === "השקע מוקפא",
    );
    await assert.rejects(
      () => getBridge().command({ deviceId, action: "OFF", source: "web", actor: "אתר" }),
      (error: unknown) => error instanceof HttpError && error.status === 403,
    );
    assert.equal((await getDevice(deviceId))?.frozen, true);
    assert.equal((await getDevice(deviceId))?.relayOn, false);
  } finally {
    await setDeviceFrozen(deviceId, false).catch(() => undefined);
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id);
  }
});
