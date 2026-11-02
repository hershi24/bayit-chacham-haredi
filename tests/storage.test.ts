import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../lib/http-error";
import { storageMode } from "../lib/storage";

test("uses sqlite until both supabase settings exist", () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.equal(storageMode(), "sqlite");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    assert.throws(() => storageMode(), (error: unknown) => error instanceof HttpError && error.status === 500);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    assert.equal(storageMode(), "supabase");
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
