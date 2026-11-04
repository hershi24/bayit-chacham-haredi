import type { RelayAction } from "@/lib/types";
import type { AppConfig } from "@/lib/config";
import { WlteError } from "@/lib/wlte/errors";
import {
  codeOf,
  isRecord,
  messageOf,
  parseCommandResponse,
  parseDeviceResponse,
  type CommandSnapshot,
  type DeviceSnapshot,
} from "@/lib/wlte/parse";
import { createIdempotencyKey, runIdempotent, type AttemptResult } from "@/lib/wlte/retry";
import type { TokenManager } from "@/lib/wlte/token-manager";

function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds;
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, (when - Date.now()) / 1000);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

export function createLiveGateway(config: AppConfig, tokens: TokenManager) {
  if (!config.clientId || !config.clientSecret) {
    throw new WlteError("AUTH_REQUIRED", 401, "חסרים WLTE_CLIENT_ID ו-WLTE_CLIENT_SECRET");
  }

  async function call(path: string, init: RequestInit, idempotencyKey?: string): Promise<AttemptResult> {
    const token = await tokens.get();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token.accessToken}`);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

    const response = await fetch(new URL(path, config.baseUrl), {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await readBody(response);
    return {
      status: response.status,
      body,
      code: codeOf(body),
      retryAfterSeconds: retryAfterSeconds(response.headers),
    };
  }

  async function send(path: string, init: RequestInit, idempotencyKey?: string): Promise<unknown> {
    let key = idempotencyKey;
    const result = await runIdempotent(
      () => call(path, init, key),
      async () => {
        await tokens.get(true);
        // A rejected login is not a stored relay command. Reusing its key can replay the
        // auth failure and skip the socket, which is why the next phone call was the one that worked.
        if (key) key = createIdempotencyKey();
      },
    );
    if (result.networkError) throw new WlteError(result.code ?? "GATEWAY_UNAVAILABLE", 503);
    if ((result.status ?? 500) >= 400) {
      throw new WlteError(result.code ?? "INTERNAL_ERROR", result.status ?? 500, messageOf(result.body));
    }
    return result.body;
  }

  return {
    async read(deviceId: string): Promise<DeviceSnapshot> {
      const body = await send(`/wlte/v1/devices/${encodeURIComponent(deviceId)}`, { method: "GET" });
      return parseDeviceResponse(body, deviceId);
    },

    async command(deviceId: string, action: RelayAction, key: string): Promise<CommandSnapshot> {
      const indexed = config.relayStyle === "indexed";
      const path = indexed
        ? `/wlte/v1/devices/${encodeURIComponent(deviceId)}/relays/1/commands`
        : `/wlte/v1/devices/${encodeURIComponent(deviceId)}/relays/commands`;
      const payload = indexed ? { action } : { relays: [{ index: 1, action }] };
      const body = await send(
        path,
        { method: "POST", body: JSON.stringify(payload) },
        key,
      );
      return parseCommandResponse(body);
    },

    async ticket(): Promise<string> {
      const body = await send("/wlte/v1/ws/ticket", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = isRecord(body) && isRecord(body.data) ? body.data : {};
      if (typeof data.ticket !== "string" || !data.ticket) {
        throw new WlteError("AUTH_INVALID", 502, "WLTE לא החזיר כרטיס WebSocket");
      }
      return data.ticket;
    },
  };
}

export async function requestAccessToken(config: AppConfig) {
  const response = await fetch(`${config.baseUrl}/wlte/v1/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new WlteError(codeOf(body) ?? "AUTH_INVALID", response.status, messageOf(body));
  }
  const data = isRecord(body) && isRecord(body.data) ? body.data : isRecord(body) ? body : {};
  if (typeof data.accessToken !== "string" || !data.accessToken) {
    throw new WlteError("AUTH_INVALID", 502, "WLTE לא החזיר אסימון");
  }
  const scopes = Array.isArray(data.scopes) ? data.scopes.filter((scope) => typeof scope === "string") : [];
  return {
    accessToken: data.accessToken,
    expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : 3600,
    scopes,
    clientId: typeof data.clientId === "string" ? data.clientId : config.clientId,
  };
}
