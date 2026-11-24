import assert from "node:assert/strict";
import test from "node:test";
import { formatClockActions, resolveActions } from "../lib/programs/actions";
import { occurrencesOn, type OccurrenceProgram } from "../lib/programs/occurrences";
import { programId, syncTenantPrograms } from "../lib/programs/sync";
import { weekdayOf } from "../lib/programs/weekdays";
import { createDevice, createTenant, deleteDevice, deleteProgram, deleteTenant, listProgramRuns, upsertProgram } from "../lib/store";

const day = "2026-11-24";

function program(slots: OccurrenceProgram["slots"]): OccurrenceProgram {
  return {
    id: "prog_actions",
    name: "דוד",
    enabled: true,
    weekdays: [weekdayOf(day)],
    startDate: null,
    endDate: null,
    deviceIds: ["boiler"],
    slots,
  };
}

test("a clock can switch off and only later switch on, on the same day", () => {
  const events = occurrencesOn(day, [
    program([
      {
        onTime: "18:00",
        offTime: "06:00",
        actions: [
          { action: "OFF", time: "06:00" },
          { action: "ON", time: "18:00" },
        ],
      },
    ]),
  ], []);
  assert.deepEqual(
    events.map((event) => [event.action, event.time]),
    [
      ["off", "06:00"],
      ["on", "18:00"],
    ],
  );
  assert.equal(occurrencesOn("2026-11-25", [program([{ onTime: "18:00", offTime: "06:00", actions: [{ action: "OFF", time: "06:00" }, { action: "ON", time: "18:00" }] }])], []).length, 0);
  assert.equal(
    formatClockActions({
      actions: [
        { action: "OFF", time: "06:00" },
        { action: "ON", time: "18:00" },
      ],
    }),
    "כיבוי 06:00 · הדלקה 18:00",
  );
});

test("a clock may be only a switch-on, or two switch-ons", () => {
  const once = occurrencesOn(day, [program([{ onTime: "08:00", offTime: null, actions: [{ action: "ON", time: "08:00" }] }])], []);
  assert.deepEqual(once.map((event) => [event.action, event.time]), [["on", "08:00"]]);
  const twice = occurrencesOn(day, [
    program([
      {
        onTime: "08:00",
        offTime: null,
        actions: [
          { action: "ON", time: "08:00" },
          { action: "ON", time: "13:00" },
        ],
      },
    ]),
  ], []);
  assert.deepEqual(
    twice.map((event) => [event.action, event.time]),
    [
      ["on", "08:00"],
      ["on", "13:00"],
    ],
  );
  assert.equal(formatClockActions({ onTime: "08:00", offTime: null }), "הדלקה 08:00");
});

test("an older pair still switches off the next morning when the off time is earlier", () => {
  assert.deepEqual(resolveActions({ onTime: "22:00", offTime: "06:00" }), [
    { action: "ON", time: "22:00" },
    { action: "OFF", time: "06:00", nextDay: true },
  ]);
  const events = occurrencesOn("2026-11-25", [
    program([{ onTime: "22:00", offTime: "06:00" }]),
  ], []);
  assert.equal(events.some((event) => event.action === "off" && event.time === "06:00" && event.sourceDay === day), true);
});

test("saved actions become program runs in the chosen order, including a lone switch-off", async () => {
  const tenant = await createTenant({ name: "פעולות שעון", phone: null });
  const deviceId = `actions${String(Date.now()).slice(-6)}`;
  const id = programId(tenant.id, "days:actions");
  try {
    await createDevice({ deviceId, name: "דוד", tenantId: tenant.id });
    await upsertProgram({
      id,
      tenantId: tenant.id,
      programKey: "days:actions",
      name: "דוד",
      enabled: true,
      deviceIds: [deviceId],
      startDate: null,
      endDate: null,
      days: [],
      weekdays: [weekdayOf(day)],
      onTime: null,
      offTime: "07:30",
      slots: [
        {
          onTime: null,
          offTime: "07:30",
          actions: [{ action: "OFF", time: "07:30" }],
          weekdays: [weekdayOf(day)],
          deviceIds: [deviceId],
        },
      ],
    });
    await syncTenantPrograms(tenant.id, new Date("2026-11-24T00:00:00.000Z"));
    const runs = (await listProgramRuns(tenant.id)).filter((run) => run.deviceId === deviceId);
    assert.ok(runs.length > 1);
    assert.ok(runs.every((run) => run.action === "OFF"));
    assert.match(runs[0]?.label ?? "", /כיבוי 07:30/);
  } finally {
    await deleteProgram(tenant.id, id).catch(() => undefined);
    await deleteDevice(deviceId).catch(() => undefined);
    await deleteTenant(tenant.id).catch(() => undefined);
  }
});
