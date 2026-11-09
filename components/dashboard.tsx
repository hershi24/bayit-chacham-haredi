"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SocketCard } from "@/components/socket-card";
import { Button } from "@/components/ui/button";
import { boardLine } from "@/lib/board-summary";
import { api } from "@/lib/client-api";
import type { DeviceIconKey } from "@/lib/devices/icons";
import { planWhen } from "@/lib/time";
import type { AuditView, BridgeStatus, DeviceView, RelayAction, SessionUser } from "@/lib/types";
type Payload = { devices: DeviceView[]; status: BridgeStatus; user?: SessionUser };

export function Dashboard() {
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [role, setRole] = useState<SessionUser["role"] | null>(null);
  const [name, setName] = useState("");
  const [audit, setAudit] = useState<AuditView[] | null>(null);
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

  const loadAudit = useCallback(async () => {
    try {
      const payload = await api<{ entries: AuditView[] }>("/api/audit");
      setAudit(payload.entries);
    } catch {
      setAudit((current) => current ?? []);
    }
  }, []);

  const load = useCallback(async (refresh: boolean) => {
    void loadAudit();
    try {
      const [session, board] = await Promise.all([
        api<{ user: SessionUser }>("/api/auth/me"),
        api<Payload>(refresh ? "/api/devices?refresh=1" : "/api/devices"),
      ]);
      setRole(session.user.role);
      setName(session.user.name);
      setDevices(board.devices);
      setStatus(board.status);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת הלוח נכשלה");
    }
  }, [loadAudit]);

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
    // Flip the switch color immediately so the tap feels instant.
    applyDevice({
      ...device,
      relayOn: action === "ON",
      stateUpdatedAt: new Date().toISOString(),
      lastError: null,
    });
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
      void loadAudit();
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

  async function renameDevice(device: DeviceView, name: string) {
    const result = await api<{ device: DeviceView }>(`/api/devices/${device.deviceId}/name`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    applyDevice(result.device);
    toast.success("הכינוי נשמר");
  }

  async function armTimer(device: DeviceView, input: { mode: "now" | "later"; time?: string; minutes: number }) {
    const result = await api<{ device: DeviceView; saved: boolean; message: string }>(`/api/devices/${device.deviceId}/timer`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    applyDevice(result.device);
    if (!result.saved) throw new Error(result.message);
    toast.success(result.message);
    void loadAudit();
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
  const connected = devices?.filter((device) => device.connectivity === "ONLINE").length ?? 0;
  const running = devices?.filter((device) => device.relayOn === true).length ?? 0;
  const upcoming = (devices ?? [])
    .filter((device): device is DeviceView & { next: NonNullable<DeviceView["next"]> } => Boolean(device.next))
    .sort((a, b) => Date.parse(a.next.at) - Date.parse(b.next.at))
    .slice(0, 5);
  const recent = (audit ?? []).filter((entry) => entry.deviceName).slice(0, 5);
  const compactBoard = count > 0 && count <= 2;

  const deviceGrid =
    count <= 1
      ? "grid w-full min-w-0 gap-4"
      : count === 2
        ? "grid w-full min-w-0 gap-4 sm:grid-cols-2"
        : "grid w-full min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3";

  const upcomingBlock = (
    <div className="min-w-0">
      <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">בהמשך</h2>
      {upcoming.length === 0 ? (
        <p className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-[14px] text-muted-foreground">אין פעולות מתוכננות.</p>
      ) : (
        <ol className="overflow-hidden rounded-2xl border border-border/60 bg-card">
          {upcoming.map((device) => (
            <li key={device.deviceId} className="flex min-w-0 items-center gap-3 border-b border-border/50 px-4 py-3 text-[15px] last:border-b-0">
              <span className="shrink-0 text-[13px] text-foreground tabular-nums" dir="ltr">
                {planWhen(device.next.at)}
              </span>
              <span className="min-w-0 flex-1 truncate">{device.name}</span>
              <span className="shrink-0 text-[13px] text-muted-foreground">{device.next.action === "ON" ? "יידלק" : "יכבה"}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  const recentBlock = (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted-foreground">פעילות אחרונה</h2>
        <Link href="/audit" className="shrink-0 text-[12px] text-primary hover:underline">
          ליומן
        </Link>
      </div>
      {audit === null ? null : recent.length === 0 ? (
        <p className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-[14px] text-muted-foreground">עוד אין פעולות.</p>
      ) : (
        <ol className="overflow-hidden rounded-2xl border border-border/60 bg-card">
          {recent.map((entry) => (
            <li key={entry.id} className="flex min-w-0 items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0">
              <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums" dir="ltr">
                {planWhen(entry.at)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">{entry.deviceName}</span>
                <span className="text-[13px] text-muted-foreground">{auditAction(entry.action)}</span>
              </span>
              <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[12px] text-muted-foreground">{sources[entry.source] ?? entry.source}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  const socketsBlock = (
    <div className="min-w-0">
      <h2 className="mb-4 text-[13px] font-medium tracking-[0.08em] text-muted-foreground uppercase">השקעים</h2>
      {devices === null && !error ? <div className="h-28 animate-pulse rounded-2xl bg-muted" /> : null}
      {devices && devices.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-6 text-start">
          <h3 className="font-medium">אין שקעים משויכים לחשבון הזה</h3>
          <p className="mt-1 text-sm text-muted-foreground">מנהל המערכת יכול לשייך שקע ללקוח מתוך מסך הניהול.</p>
        </div>
      ) : null}
      {devices && devices.length > 0 ? (
        <div className={deviceGrid}>
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
              onName={(name) => renameDevice(device, name)}
              onTimer={(input) => armTimer(device, input)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="w-full min-w-0">
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-muted-foreground">{todayLabel()}</p>
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 rounded-xl px-3 text-[13px] text-muted-foreground" onClick={() => void load(true)}>
          <RefreshCw className="size-3.5" />
          רענון
          <span className={`size-1.5 rounded-full ${live ? "bg-online" : "bg-muted-foreground/50"}`} aria-label={live ? "מחובר" : "מתחבר"} />
        </Button>
      </div>
      <div>
        <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-balance sm:text-[32px]">
          {greeting()}
          {name ? `, ${name}` : ""}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">{devices ? boardLine(connected, running) : "טוען את מצב השקעים"}</p>
      </div>
      {status?.lastError ? <p className="mt-4 text-sm text-destructive">{status.lastError}</p> : null}
      {status?.token.missingScopes.length ? (
        <p className="mt-4 text-sm text-destructive">
          לאסימון חסרות הרשאות: {status.token.missingScopes.join(", ")}
        </p>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-2xl border border-border/60 bg-card p-6">
          <p className="text-destructive">{error}</p>
          <Button className="mt-4" type="button" onClick={() => void load(true)}>
            נסו שוב
          </Button>
        </div>
      ) : null}

      {compactBoard ? (
        <div className="mt-8 grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.9fr)]">
          {socketsBlock}
          <aside className="grid min-w-0 gap-8">{upcomingBlock}{recentBlock}</aside>
        </div>
      ) : (
        <>
          <div className="mt-8">{socketsBlock}</div>
          <div className="mt-10 grid min-w-0 gap-8 md:grid-cols-2">
            {upcomingBlock}
            {recentBlock}
          </div>
        </>
      )}
    </section>
  );
}

const sources: Record<AuditView["source"], string> = {
  web: "אתר",
  ivr: "טלפון",
  stream: "בשקע",
  system: "מערכת",
};

function auditAction(action: string) {
  if (action === "ON") return "הופעל";
  if (action === "OFF") return "כובה";
  if (action.startsWith("TIMER")) return "טיימר";
  return action;
}

function jerusalemHour() {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
}

function greeting() {
  const hour = jerusalemHour();
  if (hour >= 5 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  if (hour >= 17 && hour < 22) return "ערב טוב";
  return "לילה טוב";
}

function todayLabel() {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" }).format(new Date());
}
