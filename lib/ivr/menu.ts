import { devicesForPhone, normalizePhone } from "@/lib/access";
import { decideMenu, type MenuDevice } from "@/lib/ivr/flow";
import { answerPrograms } from "@/lib/ivr/programs";
import { speechFor } from "@/lib/ivr/speech";
import { yemotRead, yemotSpeak } from "@/lib/ivr/yemot";
import { listIvrTargets, saveSchedule } from "@/lib/store";
import { nextJerusalemClock } from "@/lib/time";
import { getBridge } from "@/lib/wlte/bridge";
import { isWlteError } from "@/lib/wlte/errors";

function bag(entries: Iterable<[string, string]>) {
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value.trim()) result[key.toLowerCase()] = value.trim();
  }
  return result;
}

function present(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "none" || trimmed === "null") return undefined;
  return trimmed;
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
  const devices: MenuDevice[] = devicesForPhone(await listIvrTargets(), input.phone)
    .map((device) => ({
      deviceId: device.deviceId,
      name: device.name,
      relayOn: device.relayOn,
      connectivity: device.connectivity,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "he"))
    .slice(0, 9);
  if (!devices.length) return reply(input.format, yemotSpeak("המספר הזה לא משויך לשקע"));

  const selected = Number(present(input.values.pikud_device));
  const chosen = Number.isInteger(selected) ? devices[selected - 1] : undefined;
  // Refresh only while the caller is still choosing. Once a key asks to switch
  // the socket, answer from the state already stored and send the command after the reply.
  if (chosen && !present(input.values.pikud_action)) {
    try {
      const fresh = await getBridge().refresh(chosen.deviceId);
      if (fresh) {
        chosen.relayOn = fresh.relayOn;
        chosen.connectivity = fresh.connectivity;
        chosen.name = fresh.name || chosen.name;
      }
    } catch (error) {
      if (isWlteError(error) && error.code === "DEVICE_OFFLINE") chosen.connectivity = "OFFLINE";
    }
  }

  if (chosen && present(input.values.pikud_action) === "5") {
    const answered = await answerPrograms(chosen.deviceId, present(input.values.pikud_program));
    if (answered.type === "read") return reply(input.format, yemotRead(answered));
    return reply(input.format, yemotSpeak(answered.message));
  }

  const decision = decideMenu(devices, {
    device: present(input.values.pikud_device),
    action: present(input.values.pikud_action),
    minutes: present(input.values.pikud_minutes),
    clock: present(input.values.pikud_clock),
  });

  if (decision.type === "read") return reply(input.format, yemotRead(decision));
  if (decision.type === "say") return reply(input.format, yemotSpeak(decision.message));

  const actor = caller(input.phone);

  if (decision.type === "turn") {
    if (decision.device.connectivity === "OFFLINE") {
      return reply(input.format, yemotSpeak(speechFor({ kind: "offline" })));
    }
    sendCommand(decision.device.deviceId, decision.action, actor);
    return reply(input.format, yemotSpeak(speechFor({ kind: decision.action === "ON" ? "on-success" : "off-success" })));
  }

  if (decision.type === "timer") {
    if (decision.device.relayOn !== true) {
      if (decision.device.connectivity === "OFFLINE") {
        return reply(input.format, yemotSpeak(speechFor({ kind: "offline" })));
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

  const when = nextJerusalemClock(decision.hour, decision.minute);
  await saveSchedule({
    deviceId: decision.device.deviceId,
    kind: "later_on",
    runAt: when.at.toISOString(),
  });
  const hour = String(decision.hour).padStart(2, "0");
  const minute = String(decision.minute).padStart(2, "0");
  return reply(
    input.format,
    yemotSpeak(`${decision.device.name} יופעל ${when.today ? "היום" : "מחר"} בשעה ${hour}:${minute}`),
  );
}
