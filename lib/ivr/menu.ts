import { devicesForPhone, normalizePhone } from "@/lib/access";
import { decideMenu, type MenuDevice } from "@/lib/ivr/flow";
import { savePhoneClock } from "@/lib/ivr/phone-clock";
import { answerPrograms } from "@/lib/ivr/programs";
import { answerSettings } from "@/lib/ivr/settings";
import { speechFor } from "@/lib/ivr/speech";
import { ensureStatusCheck, statusCheckRunning } from "@/lib/ivr/status-check";
import { yemotRead, yemotSpeak } from "@/lib/ivr/yemot";
import { listIvrTargets, saveSchedule } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";
import { isWlteError } from "@/lib/wlte/errors";

const STATUS_WAIT = "מבצע בדיקת מצב ערוץ אנא המתן";

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

export async function handleMenu(request: Request) {
  const input = await incoming(request);
  if (input.values.hangup === "yes") return reply(input.format, "noop=hangup\n");

  if (!input.phone) return reply(input.format, yemotSpeak("לא זוהה מספר הטלפון"));
  const targets = devicesForPhone(await listIvrTargets(), input.phone);
  const frozen = new Set(targets.filter((device) => device.frozen).map((device) => device.deviceId));
  const devices: MenuDevice[] = targets
    .map((device) => ({
      deviceId: device.deviceId,
      name: device.name,
      relayOn: device.relayOn,
      connectivity: device.connectivity,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "he"))
    .slice(0, 9);
  if (!devices.length) return reply(input.format, yemotSpeak("המספר הזה לא משויך לשקע"));

  const tenantId = targets[0]?.tenantId;
  if (present(input.values.pikud_device) === "0") {
    if (!tenantId) return reply(input.format, yemotSpeak("לא ניתן לפתוח הגדרות כעת"));
    const answered = await answerSettings({
      tenantId,
      actorPhone: input.phone,
      deviceIds: targets.map((device) => device.deviceId),
      settings: present(input.values.pikud_settings),
      newPhone: present(input.values.pikud_new_phone),
      delPhone: present(input.values.pikud_del_phone),
      adminAsk: present(input.values.pikud_admin_ask),
    });
    if (answered.type === "read") return reply(input.format, yemotRead(answered));
    if (answered.type === "all") {
      const actor = caller(input.phone);
      const actionable = targets.filter((device) => {
        if (device.frozen) return false;
        return answered.action === "ON" ? device.relayOn !== true : device.relayOn !== false;
      });
      if (!actionable.length) {
        const idle =
          answered.action === "ON" ? "כל השקעים כבר פועלים" : "כל השקעים כבר כבויים";
        const onlyFrozen = targets.length > 0 && targets.every((device) => device.frozen);
        return reply(
          input.format,
          yemotSpeak(onlyFrozen ? "אין שקעים זמינים, כולם מוקפאים" : idle),
        );
      }
      for (const device of actionable) sendCommand(device.deviceId, answered.action, actor);
      const countWord =
        actionable.length === 1
          ? "שקע אחד"
          : actionable.length === 2
            ? "שני שקעים"
            : `${actionable.length} שקעים`;
      const message =
        answered.action === "ON"
          ? `כל השקעים הופעלו בהצלחה, ${countWord}`
          : `כל השקעים כובו בהצלחה, ${countWord}`;
      return reply(input.format, yemotSpeak(message));
    }
    return reply(input.format, yemotSpeak(answered.message));
  }

  const selected = Number(present(input.values.pikud_device));
  const chosen = Number.isInteger(selected) ? devices[selected - 1] : undefined;
  // Start live status checks while the caller still hears the device list / wait line.
  if (!present(input.values.pikud_action)) {
    for (const device of devices) {
      void ensureStatusCheck(device.deviceId).catch(() => {});
    }
  }
  // Refresh only while the caller is still choosing. Once a key asks to switch
  // the socket, answer from the state already stored and send the command after the reply.
  if (chosen && !present(input.values.pikud_action)) {
    // Only announce a wait line when the check is still running — and only once.
    // No inner comma/period: Yemot would otherwise split the sentence into two readings.
    if (!present(input.values.pikud_ready) && statusCheckRunning(chosen.deviceId)) {
      return reply(
        input.format,
        yemotRead({
          message: STATUS_WAIT,
          field: "pikud_ready",
          min: 1,
          max: 1,
          seconds: 1,
          allowEmpty: true,
          emptyVal: "1",
          // amount_attempts=2 would speak this wait line twice before continuing.
          attempts: 1,
          mode: "No",
        }),
      );
    }
    try {
      const fresh = await ensureStatusCheck(chosen.deviceId);
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
    const answered = await answerPrograms(chosen.deviceId, present(input.values.pikud_program));
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
