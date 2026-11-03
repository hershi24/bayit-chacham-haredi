import assert from "node:assert/strict";
import test from "node:test";
import { dayBars } from "../lib/programs/timeline";

const ac = {
  id: "prog_ac",
  name: "מזגן",
  enabled: true,
  weekdays: [0, 1, 2, 3, 4],
  onTime: "10:00",
  offTime: "12:00",
  deviceIds: ["rct074190118"],
};

test("weekday program fills the chosen days and skips Friday and Saturday", () => {
  const sunday = dayBars("2026-12-06", [], [ac]);
  assert.equal(sunday.length, 1);
  assert.equal(sunday[0]?.start, 10 * 60);
  assert.equal(sunday[0]?.end, 12 * 60);
  assert.equal(sunday[0]?.deviceId, "rct074190118");
  assert.equal(sunday[0]?.muted, false);
  assert.equal(dayBars("2026-12-11", [], [ac]).length, 0);
  assert.equal(dayBars("2026-12-12", [], [ac]).length, 0);
});

test("overnight clock continues on the next morning", () => {
  const clock = {
    id: "clk_night",
    day: "2026-12-06",
    onTime: "22:00",
    offTime: "06:00",
    deviceIds: ["socket-a", "socket-b"],
    programId: null,
    recurring: false,
  };
  const night = dayBars("2026-12-06", [clock], []);
  assert.equal(night.length, 2);
  assert.ok(night.every((bar) => bar.start === 22 * 60 && bar.end === 24 * 60));
  const morning = dayBars("2026-12-07", [clock], []);
  assert.equal(morning.length, 2);
  assert.ok(morning.every((bar) => bar.start === 0 && bar.end === 6 * 60));
});

test("a switched-off program stays on the bar but muted", () => {
  const bars = dayBars("2026-12-06", [], [{ ...ac, enabled: false }]);
  assert.equal(bars[0]?.muted, true);
});

test("only an on time runs until midnight and a repeated clock is not drawn twice", () => {
  const once = {
    id: "clk_on",
    day: "2026-12-06",
    onTime: "18:00",
    offTime: null,
    deviceIds: ["socket-a"],
    programId: null,
    recurring: false,
  };
  const ghost = { ...once, id: "week:prog_ac:2026-12-06", recurring: true, onTime: "10:00", offTime: "12:00" };
  const bars = dayBars("2026-12-06", [once, ghost], [ac]);
  const socket = bars.filter((bar) => bar.deviceId === "socket-a");
  assert.deepEqual(
    socket.map((bar) => [bar.start, bar.end]),
    [[18 * 60, 24 * 60]],
  );
  assert.equal(bars.filter((bar) => bar.source === "program").length, 1);
});
