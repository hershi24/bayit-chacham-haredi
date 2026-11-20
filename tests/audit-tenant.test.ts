import assert from "node:assert/strict";
import test from "node:test";
import { addAudit, createDevice, createTenant, deleteDevice, deleteTenant, listAudit } from "../lib/store";

test("an admin journal for one customer does not include another customer's actions", async () => {
  const first = await createTenant({ name: "יומן לקוח א", phone: null });
  const second = await createTenant({ name: "יומן לקוח ב", phone: null });
  const deviceA = "rctaudit0001";
  const deviceB = "rctaudit0002";
  try {
    await createDevice({ deviceId: deviceA, name: "שקע א", tenantId: first.id });
    await createDevice({ deviceId: deviceB, name: "שקע ב", tenantId: second.id });
    await addAudit({ source: "web", actor: "א", deviceId: deviceA, action: "ON", idempotencyKey: null, result: "SUCCESS", detail: null });
    await addAudit({ source: "web", actor: "ב", deviceId: deviceB, action: "OFF", idempotencyKey: null, result: "SUCCESS", detail: null });
    const admin = { role: "admin" as const, tenantId: null };
    const onlyFirst = await listAudit(admin, 50, first.id);
    assert.ok(onlyFirst.some((entry) => entry.deviceId === deviceA && entry.deviceName === "שקע א"));
    assert.equal(onlyFirst.some((entry) => entry.deviceId === deviceB), false);
    const own = await listAudit({ role: "operator", tenantId: second.id });
    assert.ok(own.some((entry) => entry.deviceId === deviceB));
    assert.equal(own.some((entry) => entry.deviceId === deviceA), false);
  } finally {
    await deleteDevice(deviceA).catch(() => undefined);
    await deleteDevice(deviceB).catch(() => undefined);
    await deleteTenant(first.id).catch(() => undefined);
    await deleteTenant(second.id).catch(() => undefined);
  }
});
