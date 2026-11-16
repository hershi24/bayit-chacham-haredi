import assert from "node:assert/strict";
import test from "node:test";
import { createUser, consumePasswordReset, findUserIdByEmail, issuePasswordReset, linkGoogleAccount, replacePassword, setUserEmail } from "../lib/store";
import { findUserForLogin } from "../lib/store";
import { verifyPassword } from "../lib/password";

test("a reset link changes the password once", async () => {
  const username = `reset-${Date.now()}`;
  await createUser({
    username,
    name: "בודק איפוס",
    password: "secret1",
    role: "admin",
    tenantId: null,
    email: `${username}@example.com`,
  });
  const user = await findUserForLogin(username);
  assert.ok(user);
  assert.equal(await findUserIdByEmail(`${username}@example.com`), user.id);

  const token = await issuePasswordReset(user.id);
  assert.equal(await consumePasswordReset(token), user.id);
  await replacePassword(user.id, "secret2");
  assert.equal(await consumePasswordReset(token), null);
  const next = await findUserForLogin(username);
  assert.equal(verifyPassword("secret2", next?.passwordHash ?? ""), true);
  assert.equal(verifyPassword("secret1", next?.passwordHash ?? ""), false);
});

test("google sign-in matches a saved email and then the google id", async () => {
  const username = `google-${Date.now()}`;
  const email = `${username}@example.com`;
  await createUser({
    username,
    name: "בודק גוגל",
    password: "secret1",
    role: "admin",
    tenantId: null,
  });
  const user = await findUserForLogin(username);
  assert.ok(user);
  await setUserEmail(user.id, email);
  assert.equal(await findUserIdByEmail(email), user.id);
  await linkGoogleAccount(user.id, `sub-${username}`, email);
  const { findUserIdByGoogleSub } = await import("../lib/store");
  assert.equal(await findUserIdByGoogleSub(`sub-${username}`), user.id);
});
