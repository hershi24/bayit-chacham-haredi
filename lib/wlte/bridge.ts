import { loadConfig, websocketUrl } from "@/lib/config";
import { HttpError } from "@/lib/http-error";
import { publishDevice, publishStatus } from "@/lib/sse";
import { storageMode } from "@/lib/storage";
import { addAudit, getDevice, listDeviceIds, updateDeviceState, type StatePatch } from "@/lib/store";
import type { AuditSource, BridgeStatus, DeviceView, RelayAction } from "@/lib/types";
import { isWlteError, wlteMessage } from "@/lib/wlte/errors";
import { createLiveGateway, requestAccessToken } from "@/lib/wlte/live";
import { MockGateway } from "@/lib/wlte/mock-gateway";
import { isNewerIso, parseCommandResponse, parseDeviceResponse, parseWsEvent } from "@/lib/wlte/parse";
import { REQUIRED_SCOPES } from "@/lib/wlte/policy";
import { createIdempotencyKey } from "@/lib/wlte/retry";
import { startLiveSocket } from "@/lib/wlte/socket";
import { TokenManager } from "@/lib/wlte/token-manager";

type Gateway = {
  read(deviceId: string): Promise<ReturnType<typeof parseDeviceResponse>>;
  command(deviceId: string, action: RelayAction, key: string): Promise<ReturnType<typeof parseCommandResponse>>;
};

const globalBridge = globalThis as unknown as { __pikudBridge?: Bridge };

function changed(before: DeviceView | null, after: DeviceView | null) {
  if (!before || !after) return Boolean(after);
  return before.relayOn !== after.relayOn || before.connectivity !== after.connectivity;
}

class Bridge {
  private readonly config = loadConfig();
  private readonly tokens: TokenManager;
  private readonly mock: MockGateway | null;
  private readonly gateway: Gateway;
  private socketState: BridgeStatus["socket"]["state"];
  private lastEventAt: string | null = null;
  private lastError: string | null = null;
  private started = false;
  private stopSocket: (() => void) | null = null;
  private ready: Promise<void> = Promise.resolve();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.tokens = new TokenManager(() =>
      this.config.mode === "mock"
        ? Promise.resolve({
            accessToken: `mock.${crypto.randomUUID()}`,
            expiresIn: 3600,
            scopes: [...REQUIRED_SCOPES],
            clientId: "mock-client",
          })
        : requestAccessToken(this.config),
    );
    this.socketState = this.config.mode === "mock" ? "mock" : "closed";
    if (this.config.mode === "mock") {
      const mock = new MockGateway([]);
      this.mock = mock;
      this.gateway = {
        read: async (deviceId) => parseDeviceResponse(mock.deviceBody(deviceId), deviceId),
        command: async (deviceId, action, key) => parseCommandResponse(mock.command(deviceId, action, key)),
      };
    } else {
      this.mock = null;
      try {
        this.gateway = createLiveGateway(this.config, this.tokens);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "הגדרת WLTE חסרה";
        const failure = error instanceof Error ? error : new Error(this.lastError);
        this.gateway = {
          read: () => Promise.reject(failure),
          command: () => Promise.reject(failure),
        };
      }
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.ready = this.boot();
    void this.ready.catch((error: unknown) => {
      console.error("[pikud]", error);
      this.note(error);
    });
  }

  private enqueue(payload: unknown) {
    this.persistQueue = this.persistQueue.then(() => this.onPayload(payload)).catch((error: unknown) => {
      this.note(error);
    });
  }

  private async boot() {
    console.info(`[pikud] WLTE mode=${this.config.mode} relay=${this.config.relayStyle} storage=${storageMode()}`);
    if (this.mock) {
      for (const deviceId of await listDeviceIds()) {
        const device = await getDevice(deviceId);
        this.mock.ensure({
          deviceId,
          name: device?.name,
          relayOn: device?.relayOn ?? false,
          online: device?.connectivity !== "OFFLINE",
        });
      }
      this.mock.onEvent((payload) => this.enqueue(payload));
    }

    void this.tokens.get().then(() => this.pushStatus()).catch((error: unknown) => this.note(error));
    const timer = setInterval(() => {
      void this.tokens
        .get()
        .then(() => this.pushStatus())
        .catch((error: unknown) => this.note(error));
    }, 30_000);
    if (typeof timer === "object" && timer && "unref" in timer) {
      timer.unref();
    }

    if (this.mock) return;

    this.stopSocket = startLiveSocket({
      ticket: async () => {
        const live = createLiveGateway(this.config, this.tokens);
        return live.ticket();
      },
      urlFor: (ticket) => websocketUrl(this.config.baseUrl, ticket),
      onMessage: (payload) => this.enqueue(payload),
      onStatus: (state, error) => {
        this.socketState = state;
        if (error) this.lastError = error;
        if (state === "open") this.lastError = null;
        this.pushStatus();
      },
      onOpen: async () => {
        for (const deviceId of await listDeviceIds()) {
          try {
            await this.refresh(deviceId, false);
          } catch (error) {
            this.note(error);
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      },
    });
  }

  status(): BridgeStatus {
    const token = this.tokens.status();
    return {
      mode: this.config.mode,
      storage: storageMode(),
      relayStyle: this.config.relayStyle,
      baseUrl: this.config.baseUrl,
      ivrTokenIsDefault: this.config.ivrTokenIsDefault,
      token: {
        state: token.state,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        missingScopes: token.missingScopes,
      },
      socket: { state: this.socketState, lastEventAt: this.lastEventAt },
      lastError: this.lastError ?? token.lastError,
    };
  }

  async refresh(deviceId: string, audit = true): Promise<DeviceView | null> {
    await this.ready;
    const before = await getDevice(deviceId);
    if (!before) return null;
    const snapshot = await this.gateway.read(deviceId);
    const view = await updateDeviceState(
      deviceId,
      {
        connectivity: snapshot.connectivity,
        relayOn: snapshot.relayOn,
        stateUpdatedAt: snapshot.stateUpdatedAt,
        deviceType: snapshot.deviceType,
        sensorSummary: snapshot.sensorSummary,
        lastError: null,
      },
      { onlyIfNewer: true },
    );
    const next = view ?? (await getDevice(deviceId));
    if (next && audit && changed(before, next)) {
      await addAudit({
        source: "system",
        actor: "סנכרון",
        deviceId,
        action: "קריאת מצב",
        idempotencyKey: null,
        result: "SUCCESS",
        detail: describe(before, next),
      });
    }
    if (next) publishDevice(next);
    return next;
  }

  async command(input: {
    deviceId: string;
    action: RelayAction;
    source: Extract<AuditSource, "web" | "ivr">;
    actor: string;
  }): Promise<{ device: DeviceView; commandId: string | null; status: string; idempotencyKey: string; requestId: string | null }> {
    await this.ready;
    const key = createIdempotencyKey();
    try {
      const command = await this.gateway.command(input.deviceId, input.action, key);
      let device: DeviceView | null = await getDevice(input.deviceId);
      if (command.status === "SUCCESS" && command.action) {
        device = await updateDeviceState(input.deviceId, {
          relayOn: command.action === "ON",
          connectivity: "ONLINE",
          stateUpdatedAt: command.createdAt ?? new Date().toISOString(),
          lastError: null,
        });
      } else {
        try {
          device = await this.refresh(input.deviceId, false);
        } catch {
          device = await getDevice(input.deviceId);
        }
        if (command.status !== "SENT") {
          device = await updateDeviceState(input.deviceId, {
            lastError: wlteMessage(command.status === "UNKNOWN" ? command.code : command.status, command.message),
          });
        }
      }
      await addAudit({
        source: input.source,
        actor: input.actor,
        deviceId: input.deviceId,
        action: input.action,
        idempotencyKey: key,
        result: command.status,
        detail: command.commandId,
      });
      const view = device ?? (await getDevice(input.deviceId));
      if (!view) throw new HttpError(404, "השקע לא נמצא");
      publishDevice(view);
      return {
        device: view,
        commandId: command.commandId,
        status: command.status,
        idempotencyKey: key,
        requestId: command.requestId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "הפקודה נכשלה";
      const device = await updateDeviceState(input.deviceId, { lastError: message });
      await addAudit({
        source: input.source,
        actor: input.actor,
        deviceId: input.deviceId,
        action: input.action,
        idempotencyKey: key,
        result: "FAILED",
        detail: message,
      });
      if (device) publishDevice(device);
      throw error;
    }
  }

  async simulate(deviceId: string, patch: { relayOn?: boolean; online?: boolean }) {
    await this.ready;
    if (!this.mock) throw new HttpError(409, "דימוי לחיצה חיצונית זמין רק במצב הדגמה");
    if (!(await getDevice(deviceId))) throw new HttpError(404, "השקע לא נמצא");
    this.mock.simulate(deviceId, patch);
    await this.persistQueue;
  }

  async registerDevice(deviceId: string, name: string) {
    await this.ready;
    if (!this.mock) {
      void this.refresh(deviceId).catch((error: unknown) => this.note(error));
      return;
    }
    this.mock.ensure({ deviceId, name, relayOn: false, online: true });
    const view = await updateDeviceState(deviceId, {
      connectivity: "ONLINE",
      relayOn: false,
      stateUpdatedAt: new Date().toISOString(),
      deviceType: "SC1_T",
      sensorSummary: "טמפרטורה: לא מחובר",
      lastError: null,
    });
    if (view) publishDevice(view);
  }

  forgetDevice(deviceId: string) {
    this.mock?.remove(deviceId);
  }

  private async onPayload(payload: unknown) {
    const event = parseWsEvent(payload);
    if (!event) return;
    const before = await getDevice(event.deviceId);
    if (!before) return;
    this.lastEventAt = new Date().toISOString();

    if (event.stateUpdatedAt && !isNewerIso(before.stateUpdatedAt, event.stateUpdatedAt)) return;

    const patch: StatePatch =
      event.type === "state"
        ? {
            relayOn: event.relayOn === null ? before.relayOn : event.relayOn,
            stateUpdatedAt: event.stateUpdatedAt ?? new Date().toISOString(),
            lastError: null,
          }
        : {
            connectivity: event.connectivity,
            stateUpdatedAt: event.stateUpdatedAt ?? new Date().toISOString(),
          };
    const view = await updateDeviceState(event.deviceId, patch);
    if (!view) return;
    if (changed(before, view)) {
      await addAudit({
        source: "stream",
        actor: "WLTE",
        deviceId: event.deviceId,
        action: event.type === "state" ? "שינוי ממסר" : event.topic,
        idempotencyKey: null,
        result: "SUCCESS",
        detail: describe(before, view),
      });
    }
    publishDevice(view);
    this.pushStatus();
  }

  private note(error: unknown) {
    this.lastError = error instanceof Error ? error.message : "שגיאה";
    if (isWlteError(error) && error.status >= 500) this.socketState = this.config.mode === "mock" ? "mock" : "closed";
    this.pushStatus();
  }

  private pushStatus() {
    publishStatus(this.status());
  }
}

function describe(before: DeviceView, after: DeviceView): string {
  const relay = (value: boolean | null) => (value === null ? "לא ידוע" : value ? "פועל" : "כבוי");
  const link = (value: DeviceView["connectivity"]) =>
    value === "ONLINE" ? "מחובר" : value === "OFFLINE" ? "מנותק" : "אין קריאה";
  return `ממסר ${relay(before.relayOn)} אל ${relay(after.relayOn)}, מנוע ${link(before.connectivity)} אל ${link(after.connectivity)}`;
}

export function getBridge(): Bridge {
  if (!globalBridge.__pikudBridge) {
    globalBridge.__pikudBridge = new Bridge();
    globalBridge.__pikudBridge.start();
  }
  return globalBridge.__pikudBridge;
}

export function startBridge() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  getBridge();
}
