import assert from "node:assert/strict";
import test from "node:test";
import { STATE_STAMP_REFRESH_MS } from "../lib/devices/state-write";
import { DUE_INTERVAL_MS } from "../lib/schedules/run";
import { getShellyHub } from "../lib/shelly/hub";
import { RELAY_HOLD_MS } from "../lib/shelly/relay-hold";
import {
  forgetShellyStatus,
  rememberShellyWrite,
  resetShellyStatusBook,
  seedShellyUnit,
  shellyDatabaseTouches,
  shellySavedChannel,
  shellyStatusApplies,
  shellyStatusIsQuiet,
} from "../lib/shelly/status-filter";
import { createShellyPro3, createTenant, deleteDevice, deleteTenant, getDevice, setDeviceName } from "../lib/store";
import type { DeviceView } from "../lib/types";

const now = Date.parse("2026-11-28T18:00:00.000Z");

function device(channel: 0 | 1 | 2, relayOn: boolean, connectivity = "ONLINE", persistedAt = "2026-11-28T18:00:00.000Z"): DeviceView {
  return {
    deviceId: `shelly-filter_ch${channel}`,
    name: `ערוץ ${channel}`,
    tenantId: "ten",
    tenantName: "לקוח",
    connectivity: connectivity as DeviceView["connectivity"],
    relayOn,
    stateUpdatedAt: persistedAt,
    deviceType: "ShellyPro3",
    sensorSummary: null,
    lastError: null,
    icon: null,
    frozen: false,
    sortOrder: channel,
    vendor: "shelly",
    kind: "panel",
    externalId: "shelly-filter",
    channel,
  };
}

test("an identical Shelly report is quiet, and a real relay change is not", () => {
  resetShellyStatusBook();
  assert.equal(DUE_INTERVAL_MS, 15_000);
  seedShellyUnit("shelly-filter", [device(0, false), device(1, false), device(2, true)]);
  const same = [
    { channel: 0 as const, on: false },
    { channel: 1 as const, on: false },
    { channel: 2 as const, on: true },
  ];
  assert.equal(shellyStatusIsQuiet("shelly-filter", same, now, () => undefined), true);
  assert.equal(shellyStatusIsQuiet("shelly-filter", [{ channel: 1, on: true }], now, () => undefined), false);
  assert.equal(
    shellyStatusIsQuiet("shelly-filter", [{ channel: 0, on: false }], now + STATE_STAMP_REFRESH_MS, () => undefined),
    false,
  );
  assert.equal(
    shellyStatusIsQuiet("shelly-filter", [{ channel: 0, on: true }], now, () => ({ on: false, at: now })),
    true,
  );
  assert.equal(
    shellyStatusIsQuiet("shelly-filter", [{ channel: 0, on: true }], now, () => ({ on: false, at: now - RELAY_HOLD_MS - 1 })),
    false,
  );
  assert.equal(
    shellyStatusIsQuiet("shelly-filter", [{ channel: 2, on: false }], now, () => ({ on: true, at: now })),
    true,
  );
  assert.equal(rememberShellyWrite("shelly-filter", null), false);
  assert.equal(shellySavedChannel("shelly-filter", 0)?.relayOn, false);
  rememberShellyWrite("shelly-filter", device(1, true));
  seedShellyUnit("shelly-filter", [device(1, false), device(0, false)]);
  assert.equal(shellySavedChannel("shelly-filter", 1)?.relayOn, true);
  forgetShellyStatus();
  assert.equal(shellyStatusIsQuiet("shelly-filter", same, now, () => undefined), false);
});

test("a repeated Shelly status does not touch the database, and a relay change still does", async () => {
  resetShellyStatusBook();
  const tenant = await createTenant({ name: `סינון שלי ${Date.now()}`, phone: null });
  const shellyId = `shellypro3g3-sf${String(Date.now()).slice(-6)}`;
  const handlers = new Map<string, (data?: unknown) => void>();
  const sent: string[] = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    on(event: string, fn: (data?: unknown) => void) {
      handlers.set(event, fn);
    },
    once(event: string, fn: (data?: unknown) => void) {
      handlers.set(event, fn);
    },
    send(payload: string) {
      sent.push(payload);
      const frame = JSON.parse(payload) as { id?: number; method?: string };
      if (frame.method !== "Shelly.GetStatus" || frame.id == null) return;
      queueMicrotask(() => {
        handlers.get("message")?.(
          JSON.stringify({
            id: frame.id,
            result: {
              "switch:0": { output: false },
              "switch:1": { output: false },
              "switch:2": { output: true },
            },
          }),
        );
      });
    },
    ping() {},
    close() {},
    terminate() {},
  };
  try {
    await createShellyPro3({
      shellyId,
      tenantId: tenant.id,
      kind: "panel",
      channels: ["א", "ב", "ג"],
    });
    getShellyHub().attach(socket as never);
    const info = JSON.parse(sent.at(-1) ?? "{}") as { id?: number };
    handlers.get("message")?.(JSON.stringify({ id: info.id, result: { id: shellyId } }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal((await getDevice(`${shellyId}_ch2`))?.relayOn, true);
    assert.equal((await getDevice(`${shellyId}_ch0`))?.connectivity, "ONLINE");

    const touches = shellyDatabaseTouches();
    const applies = shellyStatusApplies();
    handlers.get("message")?.(
      JSON.stringify({
        method: "NotifyFullStatus",
        src: shellyId,
        params: {
          "switch:0": { output: false },
          "switch:1": { output: false },
          "switch:2": { output: true },
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(shellyDatabaseTouches(), touches);
    assert.equal(shellyStatusApplies(), applies + 1);
    assert.equal((await getDevice(`${shellyId}_ch0`))?.relayOn, false);

    handlers.get("message")?.(
      JSON.stringify({ method: "NotifyStatus", src: shellyId, params: { "switch:0": { output: true } } }),
    );
    handlers.get("message")?.(
      JSON.stringify({ method: "NotifyStatus", src: shellyId, params: { "switch:0": { output: false } } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal((await getDevice(`${shellyId}_ch0`))?.relayOn, false);
    assert.equal((await getDevice(`${shellyId}_ch1`))?.relayOn, false);

    const beforeRefresh = shellyStatusApplies();
    const beforeTouches = shellyDatabaseTouches();
    const refreshed = await getShellyHub().refreshPresence(shellyId);
    assert.equal(refreshed, true);
    assert.equal(shellyStatusApplies(), beforeRefresh + 1);
    assert.equal(shellyDatabaseTouches(), beforeTouches);
    const afterQuiet = shellyDatabaseTouches();

    await setDeviceName(`${shellyId}_ch0`, "אחרי שינוי");
    handlers.get("message")?.(
      JSON.stringify({ method: "NotifyStatus", src: shellyId, params: { "switch:1": { output: false } } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(shellyDatabaseTouches() > afterQuiet);

    getShellyHub().mockDisconnect(shellyId);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal((await getDevice(`${shellyId}_ch0`))?.connectivity, "OFFLINE");
    getShellyHub().attach(socket as never);
    const again = JSON.parse(sent.at(-1) ?? "{}") as { id?: number };
    handlers.get("message")?.(JSON.stringify({ id: again.id, result: { id: shellyId } }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal((await getDevice(`${shellyId}_ch0`))?.connectivity, "ONLINE");
    assert.equal((await getDevice(`${shellyId}_ch2`))?.relayOn, true);
  } finally {
    getShellyHub().mockDisconnect(shellyId);
    resetShellyStatusBook();
    for (const channel of [0, 1, 2]) {
      try {
        await deleteDevice(`${shellyId}_ch${channel}`);
      } catch {
        // ignore
      }
    }
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});
