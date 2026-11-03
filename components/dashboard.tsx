"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SocketCard } from "@/components/socket-card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { DeviceIconKey } from "@/lib/devices/icons";
import type { BridgeStatus, DeviceView, RelayAction, SessionUser } from "@/lib/types";
type Payload = { devices: DeviceView[]; status: BridgeStatus; user?: SessionUser };

export function Dashboard() {
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [role, setRole] = useState<SessionUser["role"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, RelayAction | null>>({});
  const [live, setLive] = useState(false);

  const applyDevice = useCallback((next: DeviceView) => {
    setDevices((current) => {
      if (!current) return [next];
      const index = current.findIndex((device) => device.deviceId === next.deviceId);
      if (index === -1) return [...current, next];
      const previous = current[index];
      const merged: DeviceView = {
        ...next,
        icon: next.icon !== undefined ? next.icon : previous.icon,
        next: next.next === undefined ? previous.next : next.next,
      };
      const incomingTime = merged.stateUpdatedAt ? Date.parse(merged.stateUpdatedAt) : Number.NaN;
      const previousTime = previous.stateUpdatedAt ? Date.parse(previous.stateUpdatedAt) : Number.NaN;
      const strictlyOlder =
        Number.isFinite(incomingTime) && Number.isFinite(previousTime) && incomingTime < previousTime;
      if (strictlyOlder && merged.lastError === previous.lastError) return current;
      const planSame =
        (previous.next?.at ?? null) === (merged.next?.at ?? null) &&
        (previous.next?.action ?? null) === (merged.next?.action ?? null);
      if (
        merged.lastError === previous.lastError &&
        merged.icon === previous.icon &&
        planSame &&
        merged.relayOn === previous.relayOn &&
        merged.connectivity === previous.connectivity &&
        merged.name === previous.name
      ) {
        return current;
      }
      const copy = current.slice();
      copy[index] = merged;
      return copy;
    });
  }, []);

  const load = useCallback(async (refresh: boolean) => {
    try {
      const [session, board] = await Promise.all([
        api<{ user: SessionUser }>("/api/auth/me"),
        api<Payload>(refresh ? "/api/devices?refresh=1" : "/api/devices"),
      ]);
      setRole(session.user.role);
      setDevices(board.devices);
      setStatus(board.status);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת הלוח נכשלה");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("device", (event) => {
      applyDevice(JSON.parse((event as MessageEvent).data) as DeviceView);
    });
    source.addEventListener("status", (event) => {
      setStatus(JSON.parse((event as MessageEvent).data) as BridgeStatus);
    });
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    return () => source.close();
  }, [applyDevice]);

  async function command(device: DeviceView, action: RelayAction) {
    setBusy((current) => ({ ...current, [device.deviceId]: action }));
    try {
      const result = await api<{ device: DeviceView; status: string }>(`/api/devices/${device.deviceId}/commands`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      applyDevice(result.device);
      if (result.status === "SUCCESS") toast.success(action === "ON" ? "השקע הופעל" : "השקע כובה");
      else if (result.status === "SENT") toast.message("הפקודה נשלחה וממתינה לאישור");
      else toast.warning("הפקודה לא אושרה סופית. המצב שבכרטיס נקרא מהשקע");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "הפקודה נכשלה");
      await load(false);
    } finally {
      setBusy((current) => ({ ...current, [device.deviceId]: null }));
    }
  }

  async function chooseIcon(device: DeviceView, icon: DeviceIconKey) {
    const result = await api<{ device: DeviceView }>(`/api/devices/${device.deviceId}/icon`, {
      method: "POST",
      body: JSON.stringify({ icon }),
    });
    applyDevice(result.device);
    toast.success("האייקון נשמר");
  }

  async function armTimer(device: DeviceView, input: { mode: "now" | "later"; time?: string; minutes: number }) {
    const result = await api<{ device: DeviceView; saved: boolean; message: string }>(`/api/devices/${device.deviceId}/timer`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    applyDevice(result.device);
    if (!result.saved) throw new Error(result.message);
    toast.success(result.message);
    return result;
  }

  async function simulate(device: DeviceView, patch: { relayOn?: boolean; online?: boolean }) {
    try {
      const result = await api<{ device: DeviceView }>(`/api/devices/${device.deviceId}/simulate`, {
        method: "POST",
        body: JSON.stringify(patch),
      });
      if (result.device) applyDevice(result.device);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "הדימוי נכשל");
    }
  }

  const count = devices?.length ?? 0;
  const powered = devices?.filter((device) => device.relayOn).length ?? 0;
  const boardWidth = count <= 1 ? "max-w-md" : count === 2 ? "max-w-3xl" : "max-w-5xl";

  return (
    <section className={`mx-auto w-full ${boardWidth}`}>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[28px] leading-[34px] font-normal">השקעים</h2>
          <p className="text-[15px] leading-5 text-muted-foreground">
            {devices ? boardSummary(count, powered, live) : "טוען את מצב הממסרים"}
          </p>
        </div>
        <Button type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={() => void load(true)}>
          רענון
        </Button>
      </div>
      {status?.lastError ? <p className="mb-4 text-sm text-destructive">{status.lastError}</p> : null}
      {status?.token.missingScopes.length ? (
        <p className="mb-4 text-sm text-destructive">
          לאסימון חסרות הרשאות: {status.token.missingScopes.join(", ")}
        </p>
      ) : null}
      {error ? (
        <div className="rounded-[22px] bg-card p-6">
          <p className="text-destructive">{error}</p>
          <Button className="mt-4" type="button" onClick={() => void load(true)}>
            נסו שוב
          </Button>
        </div>
      ) : null}
      {devices === null && !error ? <div className="h-80 animate-pulse rounded-[22px] bg-muted" /> : null}
      {devices && devices.length === 0 ? (
        <div className="rounded-[22px] bg-card p-8">
          <h3 className="text-lg font-medium">אין שקעים משויכים לחשבון הזה</h3>
          <p className="mt-1 text-sm text-muted-foreground">מנהל המערכת יכול לשייך שקע ללקוח מתוך מסך הניהול.</p>
        </div>
      ) : null}
      {devices && devices.length > 0 ? (
        <div className={count === 1 ? "grid" : count === 2 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"}>
          {devices.map((device) => (
            <SocketCard
              key={device.deviceId}
              device={device}
              busy={busy[device.deviceId] ?? null}
              showTenant={role === "admin"}
              mockMode={status?.mode === "mock" && role === "admin"}
              onCommand={(action) => void command(device, action)}
              onSimulate={(patch) => void simulate(device, patch)}
              onIcon={(icon) => chooseIcon(device, icon)}
              onTimer={(input) => armTimer(device, input)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function boardSummary(count: number, powered: number, live: boolean) {
  const sockets = count === 1 ? "שקע אחד" : `${count} שקעים`;
  const running = powered === 1 ? "פועל אחד" : `${powered} פועלים`;
  return `${sockets} · ${running} · ${live ? "מחובר" : "מתחבר"}`;
}
