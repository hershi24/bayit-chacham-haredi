import { devicesForPhone, normalizePhone } from "@/lib/access";
import { decideMenu, type MenuDevice } from "@/lib/ivr/flow";
import { savePhoneClock } from "@/lib/ivr/phone-clock";
import { answerPrograms } from "@/lib/ivr/programs";
import { answerSettings } from "@/lib/ivr/settings";
import { allDoneMessage, allIdleMessage } from "@/lib/ivr/settings-menu";
import { speechFor } from "@/lib/ivr/speech";
import { awaitStatusCheck, ensureStatusCheck } from "@/lib/ivr/status-check";
import type { VoiceCommand } from "@/lib/ivr/voice-command";
import { answerVoice } from "@/lib/ivr/voice-turn";
import { yemotRead, yemotSpeak } from "@/lib/ivr/yemot";
import { listIvrTargets, saveSchedule } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";
import { isWlteError } from "@/lib/wlte/errors";

function bag(entries: Iterable<[string, string]>) {
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    const name = key.toLowerCase();
    const trimmed = value.trim();
    if (trimmed || name === "pikud_date") result[name] = trimmed;
  }
  return result;
}

function present(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "none" || trimmed === "null") return undefined;
  return trimmed;
}

function clockDate(values: Record<string, string>) {
  if (!Object.hasOwn(values, "pikud_date")) return undefined;
  return present(values.pikud_date) ?? "";
}

async function incoming(request: Request) {
  const url = new URL(request.url);
  const query = bag(url.searchParams.entries());
  let body: Record<string, string> = {};
  if (request.method !== "GET" && request.method !== "HEAD") {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const json = (await request.json().catch(() => null)) as unknown;
      if (json && typeof json === "object") {
        body = bag(Object.entries(json as Record<string, unknown>).map(([key, value]) => [key, value == null ? "" : String(value)]));
      }
    } else if (type.includes("form")) {
      const form = await request.formData();
      body = bag(Array.from(form.entries()).map(([key, value]) => [key, typeof value === "string" ? value : ""]));
    } else {
      body = bag(new URLSearchParams(await request.text()).entries());
    }
  }
  const values = { ...query, ...body };
  const phone = values.phone || values.apiphone || values.caller || values.callerid;
  const token = values.token || request.headers.get("x-ivr-token")?.trim() || "";
  return { values, phone, token, format: values.format === "json" ? "json" : "yemot" } as const;
}

function reply(format: "json" | "yemot", body: string) {
  if (format === "json") {
    return Response.json({ body });
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function caller(phone: string | undefined) {
  return phone ? `טלפון ${normalizePhone(phone)}` : "ימות המשיח";
}

function sendCommand(deviceId: string, action: "ON" | "OFF", actor: string) {
  void getBridge()
    .command({ deviceId, action, source: "ivr", actor })
    .catch((error: unknown) => {
      console.error("[pikud] ivr command", error);
    });
}

async function freshDevice(device: MenuDevice): Promise<MenuDevice> {
  try {
    const live = await awaitStatusCheck(device.deviceId);
    if (!live) return device;
    return { ...device, relayOn: live.relayOn, connectivity: live.connectivity };
  } catch (error) {
    if (isWlteError(error) && error.code === "DEVICE_OFFLINE") return { ...device, connectivity: "OFFLINE" };
    return device;
  }
}

/** Same on, off, and timer path as the keypad. A question or an unclear sentence does not switch a relay. */
async function performVoice(command: VoiceCommand, allowed: MenuDevice[], frozen: Set<string>, actor: string) {
  if (command.kind === "clarify") return command.speech;
  if (!allowed.some((item) => item.deviceId === command.device.deviceId)) return speechFor({ kind: "unauthorized" });
  const device = await freshDevice(command.device);
  if (command.kind === "status") return speechFor({ kind: "status", relayOn: device.relayOn, name: device.name });
  if (frozen.has(device.deviceId)) return speechFor({ kind: "frozen", name: device.name });
  if (command.kind === "on" || command.kind === "off") {
    if (device.connectivity === "OFFLINE") return speechFor({ kind: "offline", name: device.name });
    sendCommand(device.deviceId, command.kind === "on" ? "ON" : "OFF", actor);
    return speechFor({ kind: command.kind === "on" ? "on-success" : "off-success", name: device.name });
  }
  if (device.relayOn !== true) {
    if (device.connectivity === "OFFLINE") return speechFor({ kind: "offline", name: device.name });
    sendCommand(device.deviceId, "ON", actor);
  }
  await saveSchedule({
    deviceId: device.deviceId,
    kind: "timer_off",
    runAt: new Date(Date.now() + command.minutes * 60_000).toISOString(),
  });
  const lead = device.relayOn === true ? `${device.name} פועל` : `${device.name} הופעל`;
  return `${lead}, הוא יכבה בעוד ${command.minutes} דקות`;
}

export async function handleMenu(request: Request) {
  const input = await incoming(request);
  if (input.values.hangup === "yes") return reply(input.format, "noop=hangup\n");

  if (!input.phone) return reply(input.format, yemotSpeak("לא זוהה מספר הטלפון"));
  const targets = devicesForPhone(await listIvrTargets(), input.phone);
  const frozen = new Set(targets.filter((device) => device.frozen).map((device) => device.deviceId));
  // Keep the customer's chosen order (sort_order). listIvrTargets already sorts that way.
  const devices: MenuDevice[] = targets
    .map((device) => ({
      deviceId: device.deviceId,
      name: device.name,
      relayOn: device.relayOn,
      connectivity: device.connectivity,
    }))
    .slice(0, 9);
  if (!devices.length) return reply(input.format, yemotSpeak("המספר הזה לא משויך לשקע"));

  const voiced = await answerVoice({
    values: input.values,
    devices,
    callId: input.values.apicallid || "",
    phone: input.phone,
    perform: (command) => performVoice(command, devices, frozen, caller(input.phone)),
  });
  if (voiced) return reply(input.format, voiced);

  const tenantId = targets[0]?.tenantId;
  if (present(input.values.pikud_device) === "0") {
    if (!tenantId) return reply(input.format, yemotSpeak("לא ניתן לפתוח הגדרות כעת"));
    const answered = await answerSettings({
      tenantId,
      actorPhone: input.phone,
      deviceIds: targets.map((device) => device.deviceId),
      devices: targets.map((device) => ({ deviceId: device.deviceId, name: device.name })),
      settings: present(input.values.pikud_settings),
      newPhone: present(input.values.pikud_new_phone),
      delPhone: present(input.values.pikud_del_phone),
      adminAsk: present(input.values.pikud_admin_ask),
      orderValues: input.values,
    });
    if (answered.type === "read") return reply(input.format, yemotRead(answered));
    if (answered.type === "all") {
      const actor = caller(input.phone);
      const actionable = targets.filter((device) => {
        if (device.frozen) return false;
        return answered.action === "ON" ? device.relayOn !== true : device.relayOn !== false;
      });
      if (!actionable.length) {
        const onlyFrozen = targets.length > 0 && targets.every((device) => device.frozen);
        return reply(input.format, yemotSpeak(allIdleMessage(answered.action, onlyFrozen)));
      }
      // Skip known-offline sockets entirely so they cannot delay or starve the rest.
      const reachable = actionable.filter((device) => device.connectivity !== "OFFLINE");
      if (!reachable.length) {
        return reply(
          input.format,
          yemotSpeak(
            answered.action === "ON" ? "אין שקעים מחוברים להפעלה כעת" : "אין שקעים מחוברים לכיבוי כעת",
          ),
        );
      }
      const ordered = [...reachable].sort((left, right) => {
        const rank = (device: (typeof reachable)[number]) => (device.connectivity === "ONLINE" ? 0 : 1);
        return rank(left) - rank(right);
      });
      for (const device of ordered) sendCommand(device.deviceId, answered.action, actor);
      return reply(input.format, yemotSpeak(allDoneMessage(answered.action, ordered.length)));
    }
    return reply(input.format, yemotSpeak(answered.message));
  }

  const selected = Number(present(input.values.pikud_device));
  const chosen = Number.isInteger(selected) ? devices[selected - 1] : undefined;
  // Warm live status while the caller still hears the device list — never block the list on it.
  if (!present(input.values.pikud_action)) {
    for (const device of devices) {
      void ensureStatusCheck(device.deviceId).catch(() => {});
    }
  }
  // Refresh only while the caller is still choosing. Cap the wait so a slow gateway
  // (WLTE up to 15s / Shelly up to 8s) cannot leave silence after a keypress; fall back
  // to the last stored state and keep the check running in the background.
  if (chosen && !present(input.values.pikud_action)) {
    try {
      const fresh = await awaitStatusCheck(chosen.deviceId);
      if (fresh) {
        chosen.relayOn = fresh.relayOn;
        chosen.connectivity = fresh.connectivity;
        chosen.name = fresh.name || chosen.name;
      }
    } catch (error) {
      if (isWlteError(error) && error.code === "DEVICE_OFFLINE") chosen.connectivity = "OFFLINE";
    }
  }

  if (chosen && present(input.values.pikud_action) === "4") {
    const answered = await answerPrograms(chosen.deviceId, {
      program: present(input.values.pikud_program),
      op: present(input.values.pikud_program_op),
      slot: present(input.values.pikud_program_slot),
      side: present(input.values.pikud_side),
      on: present(input.values.pikud_on),
      off: present(input.values.pikud_off),
    });
    if (answered.type === "read") return reply(input.format, yemotRead(answered));
    return reply(input.format, yemotSpeak(answered.message));
  }

  const decision = decideMenu(devices, {
    device: present(input.values.pikud_device),
    action: present(input.values.pikud_action),
    minutes: present(input.values.pikud_minutes),
    repeat: present(input.values.pikud_repeat),
    week: present(input.values.pikud_week),
    date: clockDate(input.values),
    side: present(input.values.pikud_side),
    on: present(input.values.pikud_on),
    off: present(input.values.pikud_off),
    more: present(input.values.pikud_more),
    sockets: present(input.values.pikud_sockets),
  });

  if (decision.type === "read") return reply(input.format, yemotRead(decision));
  if (decision.type === "say") return reply(input.format, yemotSpeak(decision.message));

  const actor = caller(input.phone);

  if (decision.type === "turn") {
    if (frozen.has(decision.device.deviceId)) {
      return reply(input.format, yemotSpeak(speechFor({ kind: "frozen", name: decision.device.name })));
    }
    if (decision.device.connectivity === "OFFLINE") {
      return reply(input.format, yemotSpeak(speechFor({ kind: "offline", name: decision.device.name })));
    }
    sendCommand(decision.device.deviceId, decision.action, actor);
    return reply(
      input.format,
      yemotSpeak(
        speechFor({
          kind: decision.action === "ON" ? "on-success" : "off-success",
          name: decision.device.name,
        }),
      ),
    );
  }

  if (decision.type === "timer") {
    if (frozen.has(decision.device.deviceId)) {
      return reply(input.format, yemotSpeak(speechFor({ kind: "frozen", name: decision.device.name })));
    }
    if (decision.device.relayOn !== true) {
      if (decision.device.connectivity === "OFFLINE") {
        return reply(input.format, yemotSpeak(speechFor({ kind: "offline", name: decision.device.name })));
      }
      sendCommand(decision.device.deviceId, "ON", actor);
    }
    await saveSchedule({
      deviceId: decision.device.deviceId,
      kind: "timer_off",
      runAt: new Date(Date.now() + decision.minutes * 60_000).toISOString(),
    });
    const lead = decision.device.relayOn === true ? `${decision.device.name} פועל` : `${decision.device.name} הופעל`;
    return reply(input.format, yemotSpeak(`${lead}, הוא יכבה בעוד ${decision.minutes} דקות`));
  }

  if (decision.devices.some((device) => frozen.has(device.deviceId))) {
    return reply(input.format, yemotSpeak(speechFor({ kind: "frozen" })));
  }
  const message = await savePhoneClock(decision);
  return reply(input.format, yemotSpeak(message));
}
