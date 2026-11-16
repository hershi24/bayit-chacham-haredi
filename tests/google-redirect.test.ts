import assert from "node:assert/strict";
import test from "node:test";
import { redirectWithCookies } from "../lib/auth/google";

test("a google redirect keeps the state cookie", () => {
  const response = redirectWithCookies("https://accounts.google.com/o/oauth2/v2/auth?client_id=abc", [
    "pikud_google_state=abc; HttpOnly; Path=/; Max-Age=600; SameSite=Lax",
  ]);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc");
  assert.match(response.headers.get("set-cookie") ?? "", /pikud_google_state=abc/);
});
