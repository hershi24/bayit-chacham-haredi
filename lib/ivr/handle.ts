import { createHash, timingSafeEqual } from "node:crypto";
import { normalizePhone, resolveDevice } from "@/lib/access";
import { loadConfig } from "@/lib/config";
import { HttpError } from "@/lib/http-error";
import { speechFor, yemotBody, type IvrOutcome } from "@/lib/ivr/speech";
import { isYemotCall } from "@/lib/ivr/yemot";
import { listIvrTargets } from "@/lib/store";
import { getBridge } from "@/lib/wlte/bridge";
import { isWlteError } from "@/lib/wlte/errors";

function secretsMatch(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function bag(entries: Iterable<[string, string]>) {
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value.trim()) result[key.toLowerCase()] = value.trim();
  }
  return result;
}

async function fields(request: Request) {
  const url = new URL(request.url);
  const query = bag(url.searchParams.entries());
  let body: Record<string, string> = {};
  if (request.method !== "GET" && request.method !== "HEAD") {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const json = (await request.json().catch(() => null)) as unknown;
      if (json && typeof json === "object") {
        body = bag(
          Object.entries(json as Record<string, unknown>).map(([key, value]) => [key, value == null ? "" : String(value)]),
        );
      }
    } else if (type.includes("form")) {
      const form = await request.formData();
      body = bag(Array.from(form.entries()).map(([key, value]) => [key, typeof value === "string" ? value : ""]));
    } else {
      const text = await request.text();
      body = bag(new URLSearchParams(text).entries());
    }
  }
  const headerToken = request.headers.get("x-ivr-token")?.trim() ?? "";
  const merged = { ...query, ...body };
  const deviceId = merged.deviceid || merged.device_id;
  const phone = merged.phone || merged.apiphone || merged.caller || merged.callerid;
  const token = merged.token || headerToken;
  const format = merged.format === "json" ? "json" : "yemot";
  return { deviceId, phone, token, hangup: merged.hangup === "yes", format: format as "json" | "yemot" };
}

function respond(format: "json" | "yemot", outcome: IvrOutcome, extra?: Record<string, unknown>, jsonStatus = 200) {
  const speech = speechFor(outcome);
  if (format === "json") {
    return Response.json({ speech, outcome: outcome.kind, ...extra }, { status: jsonStatus });
  }
  return new Response(yemotBody(speech), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function handleIvr(request: Request, action: "on" | "off" | "status") {
  const input = await fields(request);
  const config = loadConfig();
  if (!isYemotCall(request) && (!input.token || !secretsMatch(input.token, config.ivrToken))) {
    return respond(input.format, { kind: "unauthorized" }, undefined, 401);
  }
  if (input.hangup) {
    return new Response("noop=hangup\n", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const resolved = resolveDevice(await listIvrTargets(), { deviceId: input.deviceId, phone: input.phone });
  if (!resolved.ok) {
    const kind = resolved.reason === "ambiguous" ? "ambiguous" : resolved.reason === "missing" ? "missing" : "not-found";
    return respond(input.format, { kind }, undefined, kind === "not-found" ? 404 : 400);
  }

  const bridge = getBridge();
  const actor = input.phone ? `טלפון ${normalizePhone(input.phone)}` : "ימות המשיח";

  if (action === "status") {
    try {
      const device = await bridge.refresh(resolved.device.deviceId);
      if (!device) return respond(input.format, { kind: "not-found" }, undefined, 404);
      if (device.connectivity === "OFFLINE") return respond(input.format, { kind: "offline" }, { device });
      return respond(input.format, { kind: "status", relayOn: device.relayOn }, { device });
    } catch (error) {
      if (isWlteError(error) && error.code === "DEVICE_OFFLINE") {
        return respond(input.format, { kind: "offline" });
      }
      return respond(input.format, { kind: "failed" }, undefined, 502);
    }
  }

  if (resolved.device.frozen) return respond(input.format, { kind: "frozen" }, undefined, 403);

  try {
    const result = await bridge.command({
      deviceId: resolved.device.deviceId,
      action: action === "on" ? "ON" : "OFF",
      source: "ivr",
      actor,
    });
    if (result.status === "SUCCESS") {
      return respond(input.format, { kind: action === "on" ? "on-success" : "off-success" }, result);
    }
    if (result.status === "SENT") return respond(input.format, { kind: "pending" }, result);
    if (result.status === "TIMEOUT") {
      return respond(input.format, { kind: "timeout", relayOn: result.device.relayOn }, result);
    }
    return respond(input.format, { kind: "failed" }, result, 502);
  } catch (error) {
    if (error instanceof HttpError && error.message === "השקע מוקפא") {
      return respond(input.format, { kind: "frozen" }, undefined, 403);
    }
    if (isWlteError(error) && (error.code === "DEVICE_OFFLINE" || error.status === 422)) {
      return respond(input.format, { kind: "offline" });
    }
    return respond(input.format, { kind: "failed" }, undefined, 502);
  }
}
