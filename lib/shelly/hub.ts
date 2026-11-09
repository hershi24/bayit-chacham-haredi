import type { WebSocket } from "ws";
import { publishDevice } from "@/lib/sse";
import {
  getDevice,
  listDevicesByExternalId,
  updateDeviceState,
} from "@/lib/store";
import { parseShellyChannelId, shellyChannelDeviceId, type ShellyChannel } from "@/lib/shelly/ids";
import {
  channelStatesFromStatus,
  getDeviceInfoCall,
  getStatusCall,
  parseShellyFrame,
  readDeviceInfoId,
  switchSetCall,
} from "@/lib/shelly/rpc";
import type { RelayAction } from "@/lib/types";

type Socket = WebSocket & { __pikudShellyId?: string };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const globalHub = globalThis as unknown as { __pikudShellyHub?: ShellyHub };

export function getShellyHub() {
  if (!globalHub.__pikudShellyHub) globalHub.__pikudShellyHub = new ShellyHub();
  return globalHub.__pikudShellyHub;
}

class ShellyHub {
  private readonly sockets = new Map<string, Socket>();
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private mockOnline = new Set<string>();
  private mockState = new Map<string, boolean>();

  /** Test helper: pretend a Shelly is connected without a real socket. */
  mockConnect(shellyId: string, channels: Array<{ channel: ShellyChannel; on?: boolean }> = []) {
    this.mockOnline.add(shellyId);
    for (const item of channels) {
      this.mockState.set(shellyChannelDeviceId(shellyId, item.channel), item.on === true);
    }
    void this.markOnline(shellyId);
  }

  mockDisconnect(shellyId: string) {
    this.mockOnline.delete(shellyId);
    void this.markOffline(shellyId);
  }

  attach(socket: Socket) {
    let nextInfoAt = Date.now();
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      void this.onMessage(socket, text).catch((error) => {
        console.error("[shelly] message", error);
      });
    });
    socket.on("close", () => {
      const id = socket.__pikudShellyId;
      if (id && this.sockets.get(id) === socket) {
        this.sockets.delete(id);
        void this.markOffline(id);
      }
    });
    socket.on("error", (error) => {
      console.error("[shelly] socket", error);
    });
    // Ask for identity once the socket is open.
    const ask = () => {
      if (Date.now() < nextInfoAt) return;
      nextInfoAt = Date.now() + 5_000;
      this.sendRaw(socket, getDeviceInfoCall(this.nextId++));
    };
    if (socket.readyState === socket.OPEN) ask();
    else socket.once("open", ask);
  }

  async command(deviceId: string, action: RelayAction): Promise<{ status: "SUCCESS" | "FAILED"; message?: string }> {
    const parsed = parseShellyChannelId(deviceId);
    if (!parsed) return { status: "FAILED", message: "מזהה ערוץ Shelly אינו תקין" };
    const on = action === "ON";

    if (this.mockOnline.has(parsed.shellyId)) {
      this.mockState.set(deviceId, on);
      const view = await updateDeviceState(deviceId, {
        relayOn: on,
        connectivity: "ONLINE",
        stateUpdatedAt: new Date().toISOString(),
        lastError: null,
      });
      if (view) publishDevice(view);
      return { status: "SUCCESS" };
    }

    const socket = this.sockets.get(parsed.shellyId);
    if (!socket || socket.readyState !== socket.OPEN) {
      return { status: "FAILED", message: "התקן Shelly אינו מחובר כעת" };
    }
    const id = this.nextId++;
    try {
      await this.request(socket, id, switchSetCall(id, parsed.channel, on));
      const view = await updateDeviceState(deviceId, {
        relayOn: on,
        connectivity: "ONLINE",
        stateUpdatedAt: new Date().toISOString(),
        lastError: null,
      });
      if (view) publishDevice(view);
      return { status: "SUCCESS" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "פקודת Shelly נכשלה";
      await updateDeviceState(deviceId, { lastError: message });
      return { status: "FAILED", message };
    }
  }

  isOnline(shellyId: string) {
    if (this.mockOnline.has(shellyId)) return true;
    const socket = this.sockets.get(shellyId);
    return Boolean(socket && socket.readyState === socket.OPEN);
  }

  private sendRaw(socket: Socket, payload: string) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }

  private request(socket: Socket, id: number, payload: string) {
    return new Promise<unknown>((resolve, reject) => {
      const key = String(id);
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error("אין תשובה מהתקן Shelly"));
      }, 8_000);
      this.pending.set(key, { resolve, reject, timer });
      this.sendRaw(socket, payload);
    });
  }

  private async onMessage(socket: Socket, text: string) {
    const frame = parseShellyFrame(text);
    if (!frame) return;

    if (frame.id != null && this.pending.has(String(frame.id))) {
      const pending = this.pending.get(String(frame.id));
      this.pending.delete(String(frame.id));
      if (pending) {
        clearTimeout(pending.timer);
        if (frame.error) pending.reject(new Error(frame.error.message || "שגיאת Shelly"));
        else pending.resolve(frame.result ?? null);
      }
    }

    const infoId = readDeviceInfoId(frame.result);
    if (infoId) {
      await this.bind(socket, infoId);
      const statusId = this.nextId++;
      this.sendRaw(socket, getStatusCall(statusId));
      return;
    }

    if (frame.method === "NotifyStatus" || frame.method === "NotifyFullStatus") {
      const shellyId = socket.__pikudShellyId ?? (typeof frame.src === "string" ? frame.src.toLowerCase() : null);
      if (shellyId) await this.applyStatus(shellyId, frame.params ?? frame);
      return;
    }

    if (frame.result && channelStatesFromStatus(frame.result).length) {
      const shellyId = socket.__pikudShellyId;
      if (shellyId) await this.applyStatus(shellyId, frame.result);
    }
  }

  private async bind(socket: Socket, shellyId: string) {
    const known = await listDevicesByExternalId(shellyId);
    if (!known.length) {
      console.warn(`[shelly] connected unknown device ${shellyId}`);
      return;
    }
    const previous = this.sockets.get(shellyId);
    if (previous && previous !== socket) {
      try {
        previous.close();
      } catch {
        // ignore
      }
    }
    socket.__pikudShellyId = shellyId;
    this.sockets.set(shellyId, socket);
    await this.markOnline(shellyId);
  }

  private async markOnline(shellyId: string) {
    const devices = await listDevicesByExternalId(shellyId);
    const at = new Date().toISOString();
    for (const device of devices) {
      const view = await updateDeviceState(device.deviceId, {
        connectivity: "ONLINE",
        stateUpdatedAt: at,
        lastError: null,
        deviceType: device.deviceType ?? "ShellyPro3",
      });
      if (view) publishDevice(view);
    }
  }

  private async markOffline(shellyId: string) {
    const devices = await listDevicesByExternalId(shellyId);
    for (const device of devices) {
      const view = await updateDeviceState(device.deviceId, {
        connectivity: "OFFLINE",
        stateUpdatedAt: new Date().toISOString(),
      });
      if (view) publishDevice(view);
    }
  }

  private async applyStatus(shellyId: string, payload: unknown) {
    const states = channelStatesFromStatus(payload);
    if (!states.length) return;
    const at = new Date().toISOString();
    for (const state of states) {
      if (typeof state.on !== "boolean") continue;
      const deviceId = shellyChannelDeviceId(shellyId, state.channel);
      if (!(await getDevice(deviceId))) continue;
      const view = await updateDeviceState(deviceId, {
        relayOn: state.on,
        connectivity: "ONLINE",
        stateUpdatedAt: at,
        lastError: null,
        deviceType: "ShellyPro3",
      });
      if (view) publishDevice(view);
    }
  }
}
