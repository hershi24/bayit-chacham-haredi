import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../lib/http-error";
import {
  cancelSchedule,
  createDevice,
  createTenant,
  deleteDevice,
  deleteTenant,
  getDevice,
  listDueSchedules,
  listTenantSchedules,
  saveSchedule,
} from "../lib/store";

test("cancelling a later switch removes it and leaves the relay alone", async () => {
  const tenant = await createTenant({ name: "בדיקת ביטול לוח", phone: "035559955" });
  await createDevice({ deviceId: "boardcancelce33", name: "דוד שמש", tenantId: tenant.id });
  const runAt = new Date(Date.now() + 30 * 60_000).toISOString();
  try {
    await saveSchedule({ deviceId: "boardcancelce33", kind: "later_on", runAt });
    const open = await listTenantSchedules(tenant.id);
    assert.equal(open.length, 1);
    assert.equal(open[0]?.kind, "later_on");
    assert.equal(open[0]?.deviceId, "boardcancelce33");

    await cancelSchedule(tenant.id, open[0]!.id);
    assert.equal((await listTenantSchedules(tenant.id)).length, 0);
    const due = await listDueSchedules(new Date(Date.now() + 31 * 60_000).toISOString());
    assert.equal(due.some((item) => item.deviceId === "boardcancelce33"), false);
    assert.notEqual((await getDevice("boardcancelce33"))?.relayOn, true);

    await assert.rejects(() => cancelSchedule(tenant.id, open[0]!.id), (error: unknown) => error instanceof HttpError && error.status === 404);
  } finally {
    await deleteDevice("boardcancelce33");
    await deleteTenant(tenant.id);
  }
});
