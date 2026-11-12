import type { WebSocket } from "ws";
import { publishDevice } from "@/lib/sse";
import { findShellyDevices, getDevice, updateDeviceState } from "@/lib/store";
import { parseShellyChannelId, shellyChannelDeviceId, shellyMac, type ShellyChannel } from "@/lib/shelly/ids";
import {
  channelStatesFromStatus,
  getDeviceInfoCall,
  getStatusCall,
  parseShellyFrame,
  readDeviceInfoId,
  switchSetCall,
} from "@/lib/shelly/rpc";
import type { RelayAction } from "@/lib/types";

type Socket = WebSocket & {
  __pikudShellyId?: string;
  /** Cleared before each ping; set again on pong / any message. */
  __pikudAlive?: boolean;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** How often we probe connected Shellies. Missed pong → offline within about 2 intervals. */
export const SHELLY_HEARTBEAT_MS = 8_000;

const globalHub = globalThis as unknown as { __pikudShellyHub?: ShellyHub };

export function getShellyHub() {
  if (!globalHub.__pikudShellyHub) globalHub.__pikudShellyHub = new ShellyHub();
  return globalHub.__pikudShellyHub;
}

class ShellyHub {
  private readonly sockets = new Map<string, Socket>();
  private readonly pending = new Map<string, Pending>();
  private readonly polls = new Map<string, Promise<boolean>>();
  private nextId = 1;
  private mockOnline = new Set<string>();
  private mockState = new Map<string, boolean>();
  private watchdog: ReturnType<typeof setInterval> | null = null;

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

  /**
   * Test helper: put a duck-typed socket on the hub and run one heartbeat tick.
   * With `alive: false` the next tick marks the unit offline (same path as a missed pong).
   */
  testHeartbeat(shellyId: string, socket: Socket, alive: boolean) {
    socket.__pikudShellyId = shellyId;
    socket.__pikudAlive = alive;
    this.sockets.set(shellyId, socket);
    this.ensureWatchdog();
    this.tickWatchdog();
  }

  attach(socket: Socket) {
    socket.__pikudAlive = true;
    socket.on("pong", () => {
      socket.__pikudAlive = true;
    });
    socket.on("message", (data) => {
      socket.__pikudAlive = true;
      const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      void this.onMessage(socket, text).catch((error) => {
        console.error("[shelly] message", error);
      });
    });
    socket.on("close", () => {
      this.forgetSocket(socket, true);
    });
    socket.on("error", (error) => {
      console.error("[shelly] socket", error);
    });
    // Ask for identity once the socket is open.
    const ask = () => {
      this.sendRaw(socket, getDeviceInfoCall(this.nextId++));
    };
    if (socket.readyState === socket.OPEN) ask();
    else socket.once("open", ask);
    this.ensureWatchdog();
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

  /**
   * Ask the unit for live switch state (or mark offline). Concurrent callers for
   * the same physical Shelly share one GetStatus round-trip.
   */
  async refreshPresence(shellyId: string): Promise<boolean> {
    if (this.mockOnline.has(shellyId)) {
      const devices = await findShellyDevices(shellyId);
      const at = new Date().toISOString();
      for (const device of devices) {
        const on = this.mockState.get(device.deviceId);
        const view = await updateDeviceState(device.deviceId, {
          connectivity: "ONLINE",
          ...(typeof on === "boolean" ? { relayOn: on } : {}),
          stateUpdatedAt: at,
          lastError: null,
        });
        if (view) publishDevice(view);
      }
      return true;
    }

    const existing = this.polls.get(shellyId);
    if (existing) return existing;

    const job = this.pollPresence(shellyId).finally(() => {
      this.polls.delete(shellyId);
    });
    this.polls.set(shellyId, job);
    return job;
  }

  private async pollPresence(shellyId: string): Promise<boolean> {
    const socket = this.sockets.get(shellyId);
    if (!socket || socket.readyState !== socket.OPEN) {
      await this.markOffline(shellyId);
      return false;
    }
    const id = this.nextId++;
    try {
      const result = await this.request(socket, id, getStatusCall(id));
      socket.__pikudAlive = true;
      await this.applyStatus(shellyId, result);
      // Connectivity even when status payload has no switch keys yet.
      await this.markOnline(shellyId);
      return true;
    } catch {
      try {
        socket.terminate();
      } catch {
        // ignore
      }
      this.forgetSocket(socket, true);
      return false;
    }
  }

  private ensureWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => this.tickWatchdog(), SHELLY_HEARTBEAT_MS);
    this.watchdog.unref?.();
  }

  private tickWatchdog() {
    const unique = new Set<Socket>();
    for (const socket of this.sockets.values()) unique.add(socket);
    for (const socket of unique) {
      if (socket.readyState !== socket.OPEN) {
        this.forgetSocket(socket, true);
        continue;
      }
      // Power cut leaves a half-open TCP socket; without a pong we never get `close`.
      if (socket.__pikudAlive === false) {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        this.forgetSocket(socket, true);
        continue;
      }
      socket.__pikudAlive = false;
      try {
        socket.ping();
      } catch {
        this.forgetSocket(socket, true);
      }
    }
  }

  private forgetSocket(socket: Socket, markOffline: boolean) {
    const id = socket.__pikudShellyId;
    let removed = false;
    for (const [key, value] of this.sockets) {
      if (value === socket) {
        this.sockets.delete(key);
        removed = true;
      }
    }
    if (markOffline && id && removed) void this.markOffline(id);
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

  private async bind(socket: Socket, reportedId: string) {
    const known = await findShellyDevices(reportedId);
    if (!known.length) {
      console.warn(`[shelly] connected unknown device ${reportedId}`);
      return;
    }
    // Prefer the id stored in admin (often the short MAC from the Shelly app).
    const canonical = known[0]?.externalId ?? reportedId;
    const aliases = new Set<string>([reportedId, canonical]);
    const mac = shellyMac(reportedId) ?? shellyMac(canonical);
    if (mac) aliases.add(mac);
    for (const device of known) {
      if (device.externalId) aliases.add(device.externalId);
    }

    for (const key of aliases) {
      const previous = this.sockets.get(key);
      if (previous && previous !== socket) {
        try {
          previous.close();
        } catch {
          // ignore
        }
      }
    }
    socket.__pikudShellyId = canonical;
    for (const key of aliases) this.sockets.set(key, socket);
    await this.markOnline(canonical);
  }

  private async markOnline(shellyId: string) {
    const devices = await findShellyDevices(shellyId);
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
    const devices = await findShellyDevices(shellyId);
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
    const devices = await findShellyDevices(shellyId);
    const byChannel = new Map(devices.map((device) => [device.channel, device]));
    const at = new Date().toISOString();
    for (const state of states) {
      if (typeof state.on !== "boolean") continue;
      const known = byChannel.get(state.channel);
      const deviceId = known?.deviceId ?? shellyChannelDeviceId(devices[0]?.externalId ?? shellyId, state.channel);
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
