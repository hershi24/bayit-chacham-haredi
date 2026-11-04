import assert from "node:assert/strict";
import test from "node:test";
import { occurrencesOn, type OccurrenceClock, type OccurrenceProgram } from "../lib/programs/occurrences";

const ac: OccurrenceProgram = {
  id: "prog_ac",
  name: "מזגן",
  enabled: true,
  weekdays: [0, 1, 2, 3, 4],
  startDate: "2026-12-01",
  endDate: "2026-12-31",
  slots: [{ onTime: "08:00", offTime: "09:00" }],
  deviceIds: ["ac"],
};

test("a weekly plan shows the switch on and the switch off, and skips Friday", () => {
  const thursday = occurrencesOn("2026-12-03", [ac], []);
  assert.deepEqual(
    thursday.map((event) => [event.action, event.time, event.name]),
    [
      ["on", "08:00", "מזגן"],
      ["off", "09:00", "כיבוי · מזגן"],
    ],
  );
  assert.equal(occurrencesOn("2026-12-04", [ac], []).length, 0);
});

test("an overnight switch off lands on the next day", () => {
  const night: OccurrenceProgram = {
    ...ac,
    id: "prog_night",
    weekdays: [4],
    slots: [{ onTime: "22:00", offTime: "06:00" }],
  };
  const today = occurrencesOn("2026-12-03", [night], []);
  const tomorrow = occurrencesOn("2026-12-04", [night], []);
  assert.deepEqual(today.map((event) => [event.action, event.time]), [["on", "22:00"]]);
  assert.equal(tomorrow.some((event) => event.action === "off" && event.time === "06:00" && event.sourceDay === "2026-12-03"), true);
});

test("a skipped date hides that clock and its next-morning off", () => {
  const night: OccurrenceProgram = {
    ...ac,
    id: "prog_skip",
    weekdays: [3, 4],
    skippedDates: ["2026-12-03"],
    slots: [{ onTime: "22:00", offTime: "06:00" }],
  };
  assert.deepEqual(
    occurrencesOn("2026-12-03", [night], []).map((event) => [event.action, event.time, event.sourceDay]),
    [["off", "06:00", "2026-12-02"]],
  );
  assert.equal(
    occurrencesOn("2026-12-04", [night], []).some((event) => event.sourceDay === "2026-12-03"),
    false,
  );
  const dated: OccurrenceProgram = { ...ac, id: "prog_dates", weekdays: [], skippedDates: ["2026-12-03"], slots: [] };
  const clock: OccurrenceClock = {
    id: "clk_skip",
    day: "2026-12-03",
    onTime: "11:00",
    offTime: "12:00",
    deviceIds: ["ac"],
    programId: dated.id,
    recurring: false,
  };
  assert.equal(occurrencesOn("2026-12-03", [dated], [clock]).length, 0);
});

test("a paused plan and a different socket stay off the filtered day", () => {
  const paused = { ...ac, id: "prog_off", enabled: false };
  const clock: OccurrenceClock = {
    id: "clk_1",
    day: "2026-12-03",
    onTime: "11:00",
    offTime: null,
    deviceIds: ["light"],
    programId: null,
    recurring: false,
  };
  assert.equal(occurrencesOn("2026-12-03", [paused], [clock], "ac").length, 0);
  assert.equal(occurrencesOn("2026-12-03", [paused], [clock], "light")[0]?.time, "11:00");
});
