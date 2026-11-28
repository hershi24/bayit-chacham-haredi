import type { WebSocket } from "ws";
import { publishDevice } from "@/lib/sse";
import { findShellyDevices, updateDeviceState } from "@/lib/store";
import { parseShellyChannelId, shellyChannelDeviceId, shellyIdsMatch, shellyMac, type ShellyChannel } from "@/lib/shelly/ids";
import {
  channelStatesFromStatus,
  getDeviceInfoCall,
  getStatusCall,
  parseShellyFrame,
  readDeviceInfoId,
  shellyCall,
  switchSetCall,
} from "@/lib/shelly/rpc";
import { STATE_STAMP_REFRESH_MS, sameObservedState } from "@/lib/devices/state-write";
import { staleRelayReport, type RelayHold } from "@/lib/shelly/relay-hold";
import {
  noteShellyDatabaseTouch,
  noteShellyStatusApplied,
  rememberShellyWrite,
  seedShellyUnit,
  shellySavedChannel,
  shellyStatusIsQuiet,
  shellyUnitIsOffline,
  shellyUnitIsOnline,
} from "@/lib/shelly/status-filter";
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
  /** Commanded relay that a status sample already in flight must not overwrite. */
  private readonly relayHold = new Map<string, RelayHold>();
  private nextId = 1;
  private mockOnline = new Set<string>();
  private mockState = new Map<string, boolean>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** Status, online, and offline for every unit stay in one order, so two frames cannot pass each other. */
  private statusChain: Promise<void> = Promise.resolve();

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
      if (view) rememberShellyWrite(parsed.shellyId, view);
      if (view) publishDevice(view);
      return { status: "SUCCESS" };
    }

    const socket = this.socketFor(parsed.shellyId);
    if (!socket || socket.readyState !== socket.OPEN) {
      return { status: "FAILED", message: "התקן Shelly אינו מחובר כעת" };
    }
    const id = this.nextId++;
    this.relayHold.set(deviceId, { on, at: Date.now() });
    try {
      await this.request(socket, id, switchSetCall(id, parsed.channel, on));
      const view = await updateDeviceState(deviceId, {
        relayOn: on,
        connectivity: "ONLINE",
        stateUpdatedAt: new Date().toISOString(),
        lastError: null,
      });
      if (view) rememberShellyWrite(parsed.shellyId, view);
      if (view) publishDevice(view);
      return { status: "SUCCESS" };
    } catch (error) {
      this.relayHold.delete(deviceId);
      const message = error instanceof Error ? error.message : "פקודת Shelly נכשלה";
      const view = await updateDeviceState(deviceId, { lastError: message });
      if (view) {
        rememberShellyWrite(parsed.shellyId, view);
        publishDevice(view);
      }
      return { status: "FAILED", message };
    }
  }

  async rpc(shellyId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const socket = this.socketFor(shellyId);
    if (!socket || socket.readyState !== socket.OPEN) throw new Error("התקן Shelly אינו מחובר כעת");
    const id = this.nextId++;
    return this.request(socket, id, shellyCall(id, method, params));
  }

  isOnline(shellyId: string) {
    if (this.mockOnline.has(shellyId)) return true;
    const socket = this.socketFor(shellyId);
    return Boolean(socket && socket.readyState === socket.OPEN);
  }

  /** Match the id the unit reported and the short MAC stored in admin. */
  private socketFor(shellyId: string) {
    const direct = this.sockets.get(shellyId);
    if (direct) return direct;
    for (const [key, socket] of this.sockets) {
      if (shellyIdsMatch(key, shellyId)) return socket;
    }
    return undefined;
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
        if (view) rememberShellyWrite(shellyId, view);
        if (view && !sameObservedState(device, view)) publishDevice(view);
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
    const socket = this.socketFor(shellyId);
    // No socket on this process does not mean the unit is down. Marking it offline
    // here used to flip every Shelly to "מנותק" on dashboard refresh.
    if (!socket || socket.readyState !== socket.OPEN) return false;
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

    // A GetStatus we asked for is applied once by the caller. Applying it here as well
    // used to run the whole status path twice for the same payload.
    if (frame.id != null && this.pending.has(String(frame.id))) {
      const pending = this.pending.get(String(frame.id));
      this.pending.delete(String(frame.id));
      if (pending) {
        clearTimeout(pending.timer);
        if (frame.error) pending.reject(new Error(frame.error.message || "שגיאת Shelly"));
        else pending.resolve(frame.result ?? null);
      }
      return;
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

  private enqueueStatus<T>(job: () => Promise<T>): Promise<T> {
    const run = this.statusChain.then(job);
    this.statusChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private markOnline(shellyId: string) {
    return this.enqueueStatus(() => this.markOnlineNow(shellyId));
  }

  private async markOnlineNow(shellyId: string) {
    const now = Date.now();
    if (shellyUnitIsOnline(shellyId, now)) return;
    noteShellyDatabaseTouch();
    const devices = await findShellyDevices(shellyId);
    if (!devices.length) return;
    seedShellyUnit(shellyId, devices);
    const at = new Date(now).toISOString();
    for (const device of devices) {
      const fresh =
        device.connectivity === "ONLINE" && (device.lastError ?? null) === null && !stampIsDue(device.stateUpdatedAt, now);
      if (fresh) continue;
      noteShellyDatabaseTouch();
      const view = await updateDeviceState(device.deviceId, {
        connectivity: "ONLINE",
        stateUpdatedAt: at,
        lastError: null,
        deviceType: device.deviceType ?? "ShellyPro3",
      });
      if (!rememberShellyWrite(shellyId, view)) continue;
      if (view && !sameObservedState(device, view)) publishDevice(view);
    }
  }

  private markOffline(shellyId: string) {
    return this.enqueueStatus(() => this.markOfflineNow(shellyId));
  }

  private async markOfflineNow(shellyId: string) {
    if (shellyUnitIsOffline(shellyId)) return;
    noteShellyDatabaseTouch();
    const devices = await findShellyDevices(shellyId);
    if (!devices.length) return;
    seedShellyUnit(shellyId, devices);
    const at = new Date().toISOString();
    for (const device of devices) {
      if (device.connectivity === "OFFLINE") continue;
      noteShellyDatabaseTouch();
      const view = await updateDeviceState(device.deviceId, {
        connectivity: "OFFLINE",
        stateUpdatedAt: at,
      });
      if (!view) continue;
      rememberShellyWrite(shellyId, view);
      if (!sameObservedState(device, view)) publishDevice(view);
    }
  }

  private applyStatus(shellyId: string, payload: unknown) {
    return this.enqueueStatus(() => this.applyStatusNow(shellyId, payload));
  }

  private async applyStatusNow(shellyId: string, payload: unknown) {
    noteShellyStatusApplied();
    const states = channelStatesFromStatus(payload).flatMap((state) =>
      typeof state.on === "boolean" ? [{ channel: state.channel, on: state.on }] : [],
    );
    if (!states.length) return;
    const now = Date.now();
    const holdFor = (deviceId: string) => this.relayHold.get(deviceId);
    if (shellyStatusIsQuiet(shellyId, states, now, holdFor)) {
      this.confirmHolds(shellyId, states);
      return;
    }

    const missing = states.some((state) => !shellySavedChannel(shellyId, state.channel));
    if (missing) {
      noteShellyDatabaseTouch();
      const devices = await findShellyDevices(shellyId);
      if (!devices.length) return;
      seedShellyUnit(shellyId, devices);
    }
    const at = new Date(now).toISOString();
    for (const state of states) {
      const known = shellySavedChannel(shellyId, state.channel);
      if (!known) continue;
      const hold = this.relayHold.get(known.deviceId);
      if (hold && state.on === hold.on) this.relayHold.delete(known.deviceId);
      if (shellyStatusIsQuiet(shellyId, [state], now, holdFor)) continue;
      const ignoreRelay = staleRelayReport(hold, state.on, now);
      const before = { relayOn: known.relayOn, connectivity: known.connectivity, lastError: known.lastError };
      noteShellyDatabaseTouch();
      const view = await updateDeviceState(known.deviceId, {
        ...(ignoreRelay ? {} : { relayOn: state.on }),
        connectivity: "ONLINE",
        stateUpdatedAt: at,
        lastError: null,
        deviceType: "ShellyPro3",
      });
      if (!rememberShellyWrite(shellyId, view) || !view) continue;
      if (view.relayOn !== before.relayOn || view.connectivity !== before.connectivity || (view.lastError ?? null) !== (before.lastError ?? null)) {
        publishDevice(view);
      }
    }
  }

  private confirmHolds(shellyId: string, states: Array<{ channel: ShellyChannel; on: boolean }>) {
    for (const state of states) {
      const saved = shellySavedChannel(shellyId, state.channel);
      if (!saved) continue;
      const hold = this.relayHold.get(saved.deviceId);
      if (hold && state.on === hold.on) this.relayHold.delete(saved.deviceId);
    }
  }
}

function stampIsDue(stamp: string | null, now: number) {
  if (!stamp) return true;
  const at = Date.parse(stamp);
  return Number.isNaN(at) || now - at >= STATE_STAMP_REFRESH_MS;
}
