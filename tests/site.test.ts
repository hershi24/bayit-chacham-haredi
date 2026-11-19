import assert from "node:assert/strict";
import test from "node:test";
import { siteUrl } from "../lib/site";

test("the public site address is used when no address is configured", () => {
  const site = process.env.SITE_URL;
  const render = process.env.RENDER_EXTERNAL_URL;
  delete process.env.SITE_URL;
  delete process.env.RENDER_EXTERNAL_URL;
  try {
    assert.equal(siteUrl(), "https://bayit-chacham-haredi.onrender.com");
  } finally {
    if (site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = site;
    if (render === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = render;
  }
});

test("an explicit site address wins and a trailing slash is removed", () => {
  const site = process.env.SITE_URL;
  process.env.SITE_URL = "https://example.com/";
  try {
    assert.equal(siteUrl(), "https://example.com");
  } finally {
    if (site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = site;
  }
});
