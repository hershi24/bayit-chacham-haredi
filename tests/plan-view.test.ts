import assert from "node:assert/strict";
import test from "node:test";
import { clockGroups, scheduledDays } from "../lib/programs/plan-view";

test("clocks that share Friday and Shabbat are titled with both days", () => {
  const groups = clockGroups(
    {
      weekdays: [5, 6],
      deviceIds: ["ac"],
      slots: [
        { onTime: null, offTime: "18:30", weekdays: [5, 6] },
        { onTime: "22:00", offTime: null, weekdays: [5, 6] },
        { onTime: "10:00", offTime: "12:00", weekdays: [5, 6] },
      ],
    },
    [],
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.title, "יום ו׳ · שבת");
  assert.deepEqual(
    groups[0]?.clocks.map((clock) => [clock.onTime, clock.offTime]),
    [
      ["10:00", "12:00"],
      [null, "18:30"],
      ["22:00", null],
    ],
  );
});

test("a clock that belongs to one day is not mixed into the other day", () => {
  const groups = clockGroups(
    {
      weekdays: [5, 6],
      deviceIds: ["ac"],
      slots: [
        { onTime: "18:30", offTime: "22:00", weekdays: [5], deviceIds: ["hall"] },
        { onTime: "10:00", offTime: "12:00", weekdays: [6], deviceIds: ["ac"] },
      ],
    },
    [],
  );
  assert.deepEqual(
    groups.map((group) => [group.title, group.clocks[0]?.deviceIds[0], group.clocks[0]?.onTime]),
    [
      ["יום ו׳", "hall", "18:30"],
      ["שבת", "ac", "10:00"],
    ],
  );
});

test("Friday and Saturday actions are listed on their own day, earliest first", () => {
  const days = scheduledDays(
    {
      weekdays: [5, 6],
      deviceIds: ["ac"],
      slots: [
        { onTime: "18:30", offTime: "10:00", weekdays: [5] },
        {
          onTime: "10:00",
          offTime: "03:00",
          actions: [
            { action: "OFF", time: "03:00" },
            { action: "ON", time: "10:00" },
            { action: "OFF", time: "12:00" },
            { action: "ON", time: "14:00" },
          ],
          weekdays: [6],
        },
      ],
    },
    [],
  );
  assert.deepEqual(
    days.map((day) => [day.title, day.actions.map((action) => `${action.action} ${action.time}`)]),
    [
      ["יום ו׳", ["ON 18:30"]],
      ["שבת", ["OFF 03:00", "ON 10:00", "OFF 10:00", "OFF 12:00", "ON 14:00"]],
    ],
  );
});

test("one-off clocks stay on their own date", () => {
  const groups = clockGroups({ weekdays: [], deviceIds: ["ac"], slots: [] }, [
    { id: "late", day: "2026-11-21", onTime: "14:00", offTime: null, deviceIds: ["ac"] },
    { id: "early", day: "2026-11-20", onTime: "18:00", offTime: "20:00", deviceIds: ["boiler"] },
    { id: "second", day: "2026-11-20", onTime: "08:00", offTime: "09:00", deviceIds: ["boiler"] },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.title, group.clocks.length]),
    [
      ["יום ו׳ 20.11", 2],
      ["שבת 21.11", 1],
    ],
  );
  assert.equal(groups[0]?.clocks[0]?.onTime, "08:00");
});
