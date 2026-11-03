import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CLOCK, formatClock, monthBoard, upcomingPrograms } from "../lib/hebrew/calendar";
import { handleMenu } from "../lib/ivr/menu";
import { looseId, programId, syncTenantPrograms } from "../lib/programs/sync";
import { weekdayOf, weekdayPhrase } from "../lib/programs/weekdays";
import {
  deleteDayClock,
  deleteProgram,
  listDayClocks,
  listProgramRuns,
  listPrograms,
  listRunsFor,
  saveDayClock,
  upsertProgram,
} from "../lib/store";
import { israelDate, jerusalemInstant } from "../lib/time";

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

test("rosh hashana is one span across two days and pesach is two separate days", async () => {
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

test("november puts the parsha on saturday and keeps candle times as labels", async () => {
  const days = await monthBoard("jerusalem", 2026, 11);
  const saturday = days.find((day) => day.date === "2026-11-07");
  const friday = days.find((day) => day.date === "2026-11-06");
  assert.equal(saturday?.weekday, 6);
  assert.equal(saturday?.parsha, "חיי שרה");
  assert.equal(friday?.parsha, null);
  assert.equal(friday?.candles, "16:05");
  assert.equal(saturday?.havdalah, "17:23");
  assert.equal(days[0]?.date, "2026-11-01");
});

test("the phone toggles a named program", async () => {
  for (const program of await listPrograms("ten_yeshiva")) {
    if (program.programKey.startsWith("days:")) await deleteProgram("ten_yeshiva", program.id);
  }
  await upsertProgram({
    id: programId("ten_yeshiva", "days:phone"),
    tenantId: "ten_yeshiva",
    programKey: "days:phone",
    name: "שבת חתן",
    enabled: false,
    deviceIds: [],
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    days: ["2026-12-01", "2026-12-02"],
    weekdays: [],
    onTime: null,
    offTime: null,
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
  assert.match(prompt, /שבת חתן/);
  assert.match(prompt, /read=/);

  const built = await handleMenu(
    new Request("http://127.0.0.1/api/ivr/menu", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
      body: new URLSearchParams({
        ApiPhone: "035551001",
        pikud_device: "1",
        pikud_action: "5",
        pikud_program: "1",
      }),
    }),
  );
  const speech = await built.text();
  assert.match(speech, /שבת חתן הופעלה, 2 ימים/);
  assert.match(speech, /go_to_folder=hangup/);
  await deleteProgram("ten_yeshiva", programId("ten_yeshiva", "days:phone"));
});

test("a day clock runs on every chosen socket and a paused program does not", async () => {
  for (const clock of await listDayClocks("ten_yeshiva")) await deleteDayClock("ten_yeshiva", clock.id);
  const program = {
    id: programId("ten_yeshiva", "days:test"),
    tenantId: "ten_yeshiva",
    programKey: "days:test",
    name: "בדיקה",
    enabled: true,
    deviceIds: [] as string[],
    startDate: "2026-12-15",
    endDate: "2026-12-15",
    days: ["2026-12-15"],
    weekdays: [],
    onTime: null,
    offTime: null,
  };
  await upsertProgram(program);
  await saveDayClock({
    id: "clk_test_two",
    tenantId: "ten_yeshiva",
    programId: program.id,
    day: "2026-12-15",
    onTime: "18:00",
    offTime: "07:00",
    deviceIds: ["rct063285302", "rct063285417"],
  });
  const now = new Date("2026-11-01T12:00:00.000Z");
  await syncTenantPrograms("ten_yeshiva", now);
  const ons = (await listRunsFor(program.id)).filter((run) => run.action === "ON");
  assert.deepEqual(ons.map((run) => run.deviceId).sort(), ["rct063285302", "rct063285417"]);
  assert.equal(ons[0]?.runAt, "2026-12-15T16:00:00.000Z");
  const offs = (await listRunsFor(program.id)).filter((run) => run.action === "OFF");
  assert.equal(offs.length, 2);
  assert.equal(offs[0]?.runAt, "2026-12-16T05:00:00.000Z");

  await upsertProgram({ ...program, enabled: false });
  await syncTenantPrograms("ten_yeshiva", now);
  assert.equal((await listRunsFor(program.id)).length, 0);
  assert.equal((await listRunsFor(looseId("ten_yeshiva"))).length, 0);

  await saveDayClock({
    id: "clk_test_loose",
    tenantId: "ten_yeshiva",
    programId: null,
    day: "2026-12-20",
    onTime: "09:00",
    offTime: null,
    deviceIds: ["rct063285302"],
  });
  await syncTenantPrograms("ten_yeshiva", now);
  const loose = await listRunsFor(looseId("ten_yeshiva"));
  assert.equal(loose.length, 1);
  assert.equal(loose[0]?.action, "ON");
  assert.equal(loose[0]?.deviceId, "rct063285302");

  await upsertProgram({
    id: programId("ten_yeshiva", "shabbat"),
    tenantId: "ten_yeshiva",
    programKey: "shabbat",
    name: "שבת",
    enabled: true,
    deviceIds: ["rct063285302"],
    startDate: null,
    endDate: null,
    days: [],
    weekdays: [],
    onTime: null,
    offTime: null,
  });
  await syncTenantPrograms("ten_yeshiva", now);
  const preset = (await listProgramRuns("ten_yeshiva")).filter((run) => run.label.includes("בראשית"));
  assert.equal(preset.length, 0);

  await deleteDayClock("ten_yeshiva", "clk_test_loose");
  await deleteProgram("ten_yeshiva", program.id);
  await syncTenantPrograms("ten_yeshiva", now);
});

test("a weekday program runs every chosen day and skips Friday and Saturday", async () => {
  const now = new Date("2026-12-01T06:00:00.000Z");
  const program = {
    id: programId("ten_shul", "days:ac"),
    tenantId: "ten_shul",
    programKey: "days:ac",
    name: "מזגן",
    enabled: true,
    deviceIds: ["rct074190118"],
    startDate: null,
    endDate: null,
    days: [] as string[],
    weekdays: [0, 1, 2, 3, 4],
    onTime: "10:00",
    offTime: "12:00",
  };
  await upsertProgram(program);
  await syncTenantPrograms("ten_shul", now);
  const runs = await listRunsFor(program.id);
  const ons = runs.filter((run) => run.action === "ON");
  const offs = runs.filter((run) => run.action === "OFF");
  assert.equal(weekdayPhrase(program.weekdays), "כל יום חוץ משישי ושבת");
  assert.ok(ons.length >= 40);
  assert.equal(ons.length, offs.length);
  for (const run of ons) {
    const day = israelDate(new Date(run.runAt));
    assert.equal(program.weekdays.includes(weekdayOf(day)), true);
    assert.equal(run.runAt, jerusalemInstant(day, "10:00")?.toISOString());
    assert.equal(run.deviceId, "rct074190118");
  }
  assert.equal(ons.some((run) => weekdayOf(israelDate(new Date(run.runAt))) === 5), false);
  assert.equal(ons.some((run) => weekdayOf(israelDate(new Date(run.runAt))) === 6), false);
  await upsertProgram({ ...program, enabled: false });
  await syncTenantPrograms("ten_shul", now);
  assert.equal((await listRunsFor(program.id)).length, 0);
  await deleteProgram("ten_shul", program.id);
});

test("the phone saves a weekday clock on the chosen socket", async () => {
  const response = await handleMenu(
    new Request("http://127.0.0.1/api/ivr/menu", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "yemot-core-api/1.0" },
      body: new URLSearchParams({
        ApiPhone: "035551002",
        pikud_device: "1",
        pikud_action: "4",
        pikud_repeat: "3",
        pikud_on: "1000",
        pikud_off: "1200",
      }),
    }),
  );
  const text = await response.text();
  assert.match(text, /נשמרה תוכנית שקע תאורה כל יום חוץ משישי ושבת/);
  assert.match(text, /הדלקה 10:00/);
  assert.match(text, /כיבוי 12:00/);
  assert.match(text, /go_to_folder=hangup/);
  const program = (await listPrograms("ten_shul")).find((item) => item.name === "שקע תאורה כל יום חוץ משישי ושבת");
  assert.ok(program);
  assert.deepEqual(program?.weekdays, [0, 1, 2, 3, 4]);
  assert.deepEqual(program?.deviceIds, ["rct074190118"]);
  assert.equal(program?.onTime, "10:00");
  assert.equal(program?.offTime, "12:00");
  if (program) await deleteProgram("ten_shul", program.id);
});
