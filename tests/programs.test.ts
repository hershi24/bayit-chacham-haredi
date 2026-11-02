import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CLOCK, formatClock, upcomingPrograms } from "../lib/hebrew/calendar";
import { handleMenu } from "../lib/ivr/menu";
import { syncTenantPrograms } from "../lib/programs/sync";
import { listProgramRuns, upsertProgram } from "../lib/store";
import { programId } from "../lib/programs/sync";

test("shabbat shows the parsha and the next week follows it", async () => {
  const programs = await upcomingPrograms(DEFAULT_CLOCK, new Date("2026-10-01T12:00:00.000Z"));
  const shabbat = programs.find((item) => item.key === "shabbat");
  assert.ok(shabbat);
  assert.equal(shabbat.windows[0]?.parsha, "בראשית");
  assert.equal(shabbat.windows[1]?.parsha, "נח");
  assert.match(shabbat.windows[0]?.title ?? "", /שבת פרשת בראשית/);
  assert.equal(formatClock(shabbat.windows[0]!.start), "17:34");
  assert.equal(formatClock(shabbat.windows[0]!.end), "18:49");
});

test("rosh hashana is one clock across two days and pesach is two separate days", async () => {
  const fall = await upcomingPrograms(DEFAULT_CLOCK, new Date("2026-09-01T12:00:00.000Z"));
  const rosh = fall.find((item) => item.key === "rosh-hashana");
  assert.equal(rosh?.windows[0]?.days, 2);
  assert.equal(formatClock(rosh!.windows[0]!.start), "18:10");
  assert.equal(formatClock(rosh!.windows[0]!.end), "19:24");
  assert.match(rosh?.windows[0]?.hebrew ?? "", /תשרי/);

  const spring = await upcomingPrograms(DEFAULT_CLOCK, new Date("2027-04-01T12:00:00.000Z"));
  const pesach = spring.find((item) => item.key === "pesach");
  assert.equal(pesach?.windows[0]?.days, 1);
  assert.equal(pesach?.windows[1]?.days, 1);
  const first = Date.parse(pesach!.windows[0]!.start);
  const second = Date.parse(pesach!.windows[1]!.start);
  assert.ok(second - first > 4 * 86_400_000 && second - first < 12 * 86_400_000);

  const shavuot = spring.find((item) => item.key === "shavuot");
  assert.equal(shavuot?.windows[0]?.includesShabbat, true);
});

test("the phone builds a holiday program without waiting for the socket", async () => {
  await upsertProgram({
    id: programId("ten_yeshiva", "rosh-hashana"),
    tenantId: "ten_yeshiva",
    programKey: "rosh-hashana",
    name: "ראש השנה",
    enabled: false,
    deviceIds: [],
    startDate: null,
    endDate: null,
  });
  const menu = await handleMenu(
    new Request("http://127.0.0.1/api/ivr/menu", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
      body: new URLSearchParams({ ApiPhone: "035551001", pikud_device: "1", pikud_action: "5" }),
    }),
  );
  const prompt = await menu.text();
  assert.equal(prompt.includes("אין הרשאה"), false);
  assert.match(prompt, /פרשת/);
  assert.match(prompt, /בשבוע שאחריה/);
  assert.match(prompt, /read=/);

  const built = await handleMenu(
    new Request("http://127.0.0.1/api/ivr/menu", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
      body: new URLSearchParams({
        ApiPhone: "035551001",
        pikud_device: "1",
        pikud_action: "5",
        pikud_program: "2",
      }),
    }),
  );
  const speech = await built.text();
  assert.match(speech, /ראש השנה נבנתה ליומיים/);
  assert.match(speech, /כניסה בשעה/);
  assert.match(speech, /go_to_folder=hangup/);

  await upsertProgram({
    id: "prog_ten_yeshiva_shabbat",
    tenantId: "ten_yeshiva",
    programKey: "shabbat",
    name: "שבת",
    enabled: true,
    deviceIds: ["rct063285302"],
    startDate: null,
    endDate: null,
  });
  await syncTenantPrograms("ten_yeshiva", new Date("2026-10-01T12:00:00.000Z"));
  const runs = await listProgramRuns("ten_yeshiva");
  const shabbatRuns = runs.filter((run) => run.label.includes("בראשית") || run.label.includes("נח"));
  assert.match(shabbatRuns.map((run) => run.label).join("\n"), /בראשית/);
  assert.match(shabbatRuns.map((run) => run.label).join("\n"), /נח/);
  assert.equal(shabbatRuns.every((run) => run.deviceId === "rct063285302"), true);
  assert.equal(shabbatRuns.some((run) => run.action === "ON"), true);
});
