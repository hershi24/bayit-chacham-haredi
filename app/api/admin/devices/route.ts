import { requireAdmin, requireUser, withErrors } from "@/lib/session";
import { cleanShellyId, parseShellyChannelId } from "@/lib/shelly/ids";
import { createDevice, createShellyPro3, listDevices } from "@/lib/store";
import { cleanDeviceId, cleanName, readJson } from "@/lib/validate";
import { HttpError } from "@/lib/http-error";
import { getBridge } from "@/lib/wlte/bridge";
import { shellyWsPath } from "@/lib/shelly/server";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
    const wsProto = proto === "https" ? "wss" : "ws";
    return Response.json({
      devices: await listDevices(user),
      shelly: {
        outboundUrl: `${wsProto}://${host}${shellyWsPath()}`,
        certificateHint: "*",
      },
    });
  });
}

export function POST(request: Request) {
  return withErrors(async () => {
    const user = await requireUser();
    requireAdmin(user);
    const body = await readJson(request);
    if (typeof body.tenantId !== "string" || !body.tenantId) throw new HttpError(400, "יש לבחור לקוח");

    if (body.vendor === "shelly" || body.type === "shelly-pro3") {
      let shellyId: string;
      try {
        shellyId = cleanShellyId(body.shellyId ?? body.deviceId);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "מזהה Shelly אינו תקין");
      }
      const kind = body.kind === "socket" ? "socket" : "panel";
      const channelsRaw = Array.isArray(body.channels) ? body.channels : [];
      const channels: [string, string, string] = [
        cleanName(channelsRaw[0] ?? body.name1 ?? `${kind === "panel" ? "לוח" : "שקע"} ערוץ 1`, "שם ערוץ 1"),
        cleanName(channelsRaw[1] ?? body.name2 ?? `${kind === "panel" ? "לוח" : "שקע"} ערוץ 2`, "שם ערוץ 2"),
        cleanName(channelsRaw[2] ?? body.name3 ?? `${kind === "panel" ? "לוח" : "שקע"} ערוץ 3`, "שם ערוץ 3"),
      ];
      const created = await createShellyPro3({ shellyId, tenantId: body.tenantId, kind, channels });
      for (const deviceId of created) {
        const parsed = parseShellyChannelId(deviceId);
        const channelName = parsed ? channels[parsed.channel] : deviceId;
        await getBridge().registerDevice(deviceId, channelName);
      }
      return Response.json({ devices: await listDevices(user), created }, { status: 201 });
    }

    const deviceId = cleanDeviceId(body.deviceId);
    const name = cleanName(body.name, "שם השקע");
    await createDevice({ deviceId, name, tenantId: body.tenantId, vendor: "wlte", kind: "socket" });
    await getBridge().registerDevice(deviceId, name);
    return Response.json({ devices: await listDevices(user) }, { status: 201 });
  });
}
