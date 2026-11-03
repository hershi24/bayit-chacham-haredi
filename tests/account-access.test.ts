import assert from "node:assert/strict";
import test from "node:test";
import { devicesForPhone } from "../lib/access";
import { verifyPassword } from "../lib/password";
import {
  addCallerNumber,
  changeOwnPassword,
  createDevice,
  createSession,
  createTenant,
  createUser,
  deleteDevice,
  deleteTenant,
  deleteUser,
  findUserForLogin,
  listDevices,
  listIvrTargets,
  listUsers,
  readSession,
  removeCallerNumber,
  updateUser,
} from "../lib/store";

test("a customer can be limited to chosen sockets, and another phone can call the same sockets", async () => {
  const tenant = await createTenant({ name: "לקוח בדיקת גישה", phone: "0540001001" });
  const other = await createTenant({ name: "לקוח בדיקה נוסף", phone: null });
  const deviceA = "rctaccess0001";
  const deviceB = "rctaccess0002";
  let userId = "";
  try {
    await assert.rejects(
      () => updateUser({
        id: "usr_admin",
        actorId: "usr_admin",
        name: "מנהל המערכת",
        role: "operator",
        tenantId: tenant.id,
        password: null,
        deviceIds: null,
      }),
      /המשתמש המחובר/,
    );
    await createDevice({ deviceId: deviceA, name: "שקע א בדיקה", tenantId: tenant.id });
    await createDevice({ deviceId: deviceB, name: "שקע ב בדיקה", tenantId: tenant.id });
    await createUser({
      username: "access-test",
      name: "בודק גישה",
      password: "secret1",
      role: "operator",
      tenantId: tenant.id,
    });
    userId = (await listUsers()).find((user) => user.username === "access-test")?.id ?? "";
    assert.ok(userId);
    const open = await listDevices({ id: userId, role: "operator", tenantId: tenant.id });
    assert.deepEqual(open.map((device) => device.deviceId).sort(), [deviceA, deviceB]);

    await updateUser({
      id: userId,
      actorId: "usr_admin",
      name: "בודק גישה",
      role: "operator",
      tenantId: tenant.id,
      password: null,
      deviceIds: [deviceA],
    });
    const limited = await listDevices({ id: userId, role: "operator", tenantId: tenant.id });
    assert.deepEqual(limited.map((device) => device.deviceId), [deviceA]);

    const added = await addCallerNumber(tenant.id, "0540001002");
    const mine = (await listIvrTargets()).filter((device) => device.tenantId === tenant.id);
    assert.equal(mine.length, 2);
    assert.ok(mine.every((device) => device.phones.includes("0540001001") && device.phones.includes("0540001002")));
    assert.equal(devicesForPhone(mine, "972540001002").length, 2);
    await assert.rejects(() => addCallerNumber(other.id, "0540001002"), /לקוח אחר/);
    await removeCallerNumber(tenant.id, added.id);
    const after = (await listIvrTargets()).find((device) => device.deviceId === deviceA);
    assert.equal(after?.phones.includes("0540001002"), false);
    assert.equal(after?.phones.includes("0540001001"), true);

    await updateUser({
      id: userId,
      actorId: "usr_admin",
      name: "בודק גישה",
      role: "operator",
      tenantId: tenant.id,
      password: null,
      deviceIds: null,
    });
    const restored = await listDevices({ id: userId, role: "operator", tenantId: tenant.id });
    assert.deepEqual(restored.map((device) => device.deviceId).sort(), [deviceA, deviceB]);

    await assert.rejects(() => changeOwnPassword(userId, "nope", "secret2"), /הנוכחית/);
    const kept = await createSession(userId);
    await changeOwnPassword(userId, "secret1", "secret2");
    assert.equal((await readSession(kept.id))?.id, userId);
    const changed = await findUserForLogin("access-test");
    assert.equal(verifyPassword("secret2", changed?.passwordHash ?? ""), true);
    assert.equal(verifyPassword("secret1", changed?.passwordHash ?? ""), false);

    const dropped = await createSession(userId);
    await updateUser({
      id: userId,
      actorId: "usr_admin",
      name: "בודק גישה",
      role: "operator",
      tenantId: tenant.id,
      password: "secret3",
      deviceIds: null,
    });
    assert.equal(await readSession(dropped.id), null);
    assert.equal(await readSession(kept.id), null);
    const reset = await findUserForLogin("access-test");
    assert.equal(verifyPassword("secret3", reset?.passwordHash ?? ""), true);
  } finally {
    if (userId) await deleteUser(userId, "usr_admin");
    await deleteDevice(deviceA).catch(() => undefined);
    await deleteDevice(deviceB).catch(() => undefined);
    await deleteTenant(tenant.id);
    await deleteTenant(other.id);
  }
});
