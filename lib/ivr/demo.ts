import { normalizePhone } from "@/lib/access";
import { clockSavedMessage, decideMenu, type MenuDevice, type MenuRead } from "@/lib/ivr/flow";
import {
  askOff,
  askOn,
  confirmToggle,
  detailMenu,
  emptyMessage,
  listMenu,
  noHoursMessage,
  parsePhoneClock,
  pickSlotMenu,
  programSlots,
  slotLabel,
  slotSideMenu,
  slotUpdated,
  type SpokenProgram,
} from "@/lib/ivr/programs-menu";
import {
  ADMIN_CANCELLED,
  ADMIN_SENT,
  allDoneMessage,
  allIdleMessage,
  askAdminConfirm,
  askNewPhone,
  askRemove,
  auditLine,
  auditMessage,
  phoneAdded,
  phoneRemoved,
  REMOVE_CANCELLED,
  settingsMenu,
} from "@/lib/ivr/settings-menu";
import { speechFor } from "@/lib/ivr/speech";

/** Sample household for the public landing-page call demo. Runs the same menu text as the live line. */
export type DemoHome = {
  devices: MenuDevice[];
  programs: Record<string, SpokenProgram[]>;
  phones: string[];
  log: Array<{ at: string; device: string | null; action: string }>;
};

export type DemoTurn =
  | { type: "read"; read: MenuRead }
  | { type: "wait"; message: string }
  | { type: "say"; message: string };

export type DemoValues = Record<string, string>;

const everyDay = [0, 1, 2, 3, 4, 5, 6];

export function demoHome(now = Date.now()): DemoHome {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  return {
    devices: [
      { deviceId: "boiler", name: "דוד שמש", relayOn: false, connectivity: "ONLINE" },
      { deviceId: "ac", name: "מזגן בסלון", relayOn: true, connectivity: "ONLINE" },
      { deviceId: "yard", name: "תאורת חצר", relayOn: false, connectivity: "ONLINE" },
    ],
    programs: {
      boiler: [
        {
          name: "דוד בוקר וערב",
          enabled: true,
          weekdays: everyDay,
          days: [],
          onTime: null,
          offTime: null,
          slots: [
            { onTime: "05:30", offTime: "06:30" },
            { onTime: "17:00", offTime: "18:00" },
          ],
        },
      ],
      ac: [
        {
          name: "מזגן לילה",
          enabled: false,
          weekdays: [0, 1, 2, 3, 4],
          days: [],
          onTime: null,
          offTime: null,
          slots: [{ onTime: "22:00", offTime: "02:00" }],
        },
      ],
      yard: [],
    },
    phones: ["0583296967", "0527654321"],
    log: [
      { at: ago(35), device: "דוד שמש", action: "OFF" },
      { at: ago(140), device: "מזגן בסלון", action: "ON" },
      { at: ago(600), device: "תאורת חצר", action: "OFF" },
    ],
  };
}

function present(value: string | undefined) {
  return value === undefined || value === "" ? undefined : value;
}

const read = (decision: MenuRead): DemoTurn => ({ type: "read", read: decision });
const say = (message: string): DemoTurn => ({ type: "say", message });

/** One step of the call. Mutates `home` the way the live line would change the account. */
export function demoAnswer(home: DemoHome, values: DemoValues): DemoTurn {
  const devices = home.devices;
  const device = present(values.pikud_device);

  if (device === "0") return settings(home, values);

  const chosen = device ? devices[Number(device) - 1] : undefined;
  const action = present(values.pikud_action);
  // Live IVR no longer inserts a status-wait round-trip; answer the device menu immediately.

  if (chosen && action === "4") return programs(home, chosen, values);

  const decision = decideMenu(devices, {
    device,
    action,
    minutes: present(values.pikud_minutes),
    repeat: present(values.pikud_repeat),
    week: present(values.pikud_week),
    date: values.pikud_date,
    side: present(values.pikud_side),
    on: present(values.pikud_on),
    off: present(values.pikud_off),
    more: present(values.pikud_more),
    sockets: present(values.pikud_sockets),
  });

  if (decision.type === "read") return read(decision);
  if (decision.type === "say") return say(decision.message);

  if (decision.type === "turn") {
    if (decision.device.connectivity === "OFFLINE") return say(speechFor({ kind: "offline", name: decision.device.name }));
    decision.device.relayOn = decision.action === "ON";
    log(home, decision.device.name, decision.action);
    return say(speechFor({ kind: decision.action === "ON" ? "on-success" : "off-success", name: decision.device.name }));
  }

  if (decision.type === "timer") {
    const wasOn = decision.device.relayOn === true;
    decision.device.relayOn = true;
    log(home, decision.device.name, "TIMER");
    const lead = wasOn ? `${decision.device.name} פועל` : `${decision.device.name} הופעל`;
    return say(`${lead}, הוא יכבה בעוד ${decision.minutes} דקות`);
  }

  return say(clockSavedMessage(decision));
}

function log(home: DemoHome, device: string | null, action: string) {
  home.log.unshift({ at: new Date().toISOString(), device, action });
}

function settings(home: DemoHome, values: DemoValues): DemoTurn {
  const choice = present(values.pikud_settings);
  const newPhone = values.pikud_new_phone;
  const delPhone = values.pikud_del_phone;
  const adminAsk = values.pikud_admin_ask;

  if (!choice) return read(settingsMenu());

  if (choice === "1") {
    if (!present(newPhone)) return read(askNewPhone());
    const phone = normalizePhone(newPhone!);
    if (phone.length < 8 || phone.length > 15) return say("מספר טלפון אינו תקין");
    if (!home.phones.includes(phone)) home.phones.push(phone);
    log(home, null, "PHONE_ADD");
    return say(phoneAdded(phone));
  }

  if (choice === "2") {
    if (delPhone === undefined) {
      const asked = askRemove(home.phones.map((phone) => ({ phone })));
      return asked.type === "read" ? read(asked) : say(asked.message);
    }
    if (delPhone === "0") return say(REMOVE_CANCELLED);
    const phone = home.phones[Number(delPhone) - 1];
    if (!phone) return say("הבחירה לא קיימת");
    home.phones = home.phones.filter((item) => item !== phone);
    log(home, null, "PHONE_REMOVE");
    return say(phoneRemoved(phone));
  }

  if (choice === "3") {
    return say(auditMessage(home.log.slice(0, 5).map((entry) => auditLine(entry.at, entry.device, entry.action))));
  }

  if (choice === "4") {
    if (!adminAsk) return read(askAdminConfirm());
    return say(adminAsk === "1" ? ADMIN_SENT : ADMIN_CANCELLED);
  }

  if (choice === "5" || choice === "6") {
    const action = choice === "5" ? "ON" : "OFF";
    const actionable = home.devices.filter((item) => (action === "ON" ? item.relayOn !== true : item.relayOn !== false));
    if (!actionable.length) return say(allIdleMessage(action, false));
    for (const item of actionable) {
      item.relayOn = action === "ON";
      log(home, item.name, action);
    }
    return say(allDoneMessage(action, actionable.length));
  }

  const menu = settingsMenu();
  return read({ ...menu, message: `הבחירה לא קיימת, ${menu.message}` });
}

function programs(home: DemoHome, device: MenuDevice, values: DemoValues): DemoTurn {
  const list = home.programs[device.deviceId] ?? [];
  if (!list.length) return say(emptyMessage(device.name));
  const pick = present(values.pikud_program);
  if (!pick) return read(listMenu(list, device.name));

  const program = list[Number(pick) - 1];
  if (!program) return read(listMenu(list, device.name, "הבחירה לא קיימת"));

  const op = present(values.pikud_program_op);
  if (!op) return read(detailMenu(program));
  if (op === "1") {
    program.enabled = !program.enabled;
    return say(confirmToggle(program, program.enabled));
  }
  if (op !== "2") return read(detailMenu(program, "הבחירה לא קיימת"));

  const slots = programSlots(program);
  if (!slots.length) return say(noHoursMessage(program));
  let slotIndex = 0;
  if (slots.length > 1) {
    const slotPick = present(values.pikud_program_slot);
    if (!slotPick) return read(pickSlotMenu(program, slots));
    slotIndex = Number(slotPick) - 1;
    if (!slots[slotIndex]) return read(pickSlotMenu(program, slots, "הבחירה לא קיימת"));
  }
  const slot = slots[slotIndex]!;
  const side = present(values.pikud_side);
  if (side !== "1" && side !== "2") return read(slotSideMenu(program, slot, slotIndex));

  const label = slotLabel(slotIndex);
  if (side === "1") {
    const on = parsePhoneClock(present(values.pikud_on));
    if (!on) return read(askOn(values.pikud_on ? "השעה לא תקינה, " : `${label}, `));
    program.slots = slots.map((item, index) => (index === slotIndex ? { ...item, onTime: on } : item));
    return say(slotUpdated(program, slotIndex, "on", on));
  }
  const off = parsePhoneClock(present(values.pikud_off));
  if (!off) return read(askOff(values.pikud_off ? "השעה לא תקינה, " : `${label}, `));
  program.slots = slots.map((item, index) => (index === slotIndex ? { ...item, offTime: off } : item));
  return say(slotUpdated(program, slotIndex, "off", off));
}
