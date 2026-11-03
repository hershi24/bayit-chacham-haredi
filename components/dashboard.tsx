"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SocketCard } from "@/components/socket-card";
import { Button } from "@/components/ui/button";
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
  const powered = devices?.filter((device) => device.relayOn && !device.frozen).length ?? 0;
  const offline = devices?.filter((device) => device.connectivity === "OFFLINE").length ?? 0;
  const upcoming = (devices ?? [])
    .filter((device): device is DeviceView & { next: NonNullable<DeviceView["next"]> } => Boolean(device.next))
    .sort((a, b) => Date.parse(a.next.at) - Date.parse(b.next.at))
    .slice(0, 5);
  const recent = (audit ?? []).filter((entry) => entry.deviceName).slice(0, 5);

  return (
    <section>
      <div className="mb-8 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">{todayLabel()}</p>
          <h1 className="mt-1 text-[26px] leading-8 font-semibold tracking-tight">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {devices ? boardSummary(count, powered, offline, upcoming[0]) : "טוען את מצב השקעים"}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 rounded-full px-3 text-[13px] text-muted-foreground" onClick={() => void load(true)}>
          <RefreshCw className="size-3.5" />
          רענון
          <span className={`size-1.5 rounded-full ${live ? "bg-online" : "bg-muted-foreground/50"}`} aria-label={live ? "מחובר" : "מתחבר"} />
        </Button>
      </div>
      {status?.lastError ? <p className="mb-4 text-sm text-destructive">{status.lastError}</p> : null}
      {status?.token.missingScopes.length ? (
        <p className="mb-4 text-sm text-destructive">
          לאסימון חסרות הרשאות: {status.token.missingScopes.join(", ")}
        </p>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-border/60 bg-card p-6">
          <p className="text-destructive">{error}</p>
          <Button className="mt-4" type="button" onClick={() => void load(true)}>
            נסו שוב
          </Button>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div>
          <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">השקעים</h2>
          {devices === null && !error ? <div className="h-28 animate-pulse rounded-2xl bg-muted" /> : null}
          {devices && devices.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <h3 className="font-medium">אין שקעים משויכים לחשבון הזה</h3>
              <p className="mt-1 text-sm text-muted-foreground">מנהל המערכת יכול לשייך שקע ללקוח מתוך מסך הניהול.</p>
            </div>
          ) : null}
          {devices && devices.length > 0 ? (
            <div className={count === 1 ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
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
        </div>

        <aside className="grid content-start gap-8">
          <div>
            <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">בהמשך</h2>
            {upcoming.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">
                אין פעולות מתוכננות.{" "}
                <Link href="/programs" className="text-primary hover:underline">
                  לתוכניות
                </Link>
              </p>
            ) : (
              <ol className="grid gap-2.5">
                {upcoming.map((device) => (
                  <li key={device.deviceId} className="flex items-baseline gap-3 text-[14px]">
                    <span className="w-16 shrink-0 font-mono text-[13px] text-foreground" dir="ltr">
                      {planWhen(device.next.at)}
                    </span>
                    <span className="min-w-0 truncate">
                      {device.name} <span className="text-muted-foreground">{device.next.action === "ON" ? "יידלק" : "יכבה"}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[13px] font-medium text-muted-foreground">פעילות אחרונה</h2>
              <Link href="/audit" className="text-[12px] text-primary hover:underline">
                ליומן
              </Link>
            </div>
            {audit === null ? null : recent.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">עוד אין פעולות.</p>
            ) : (
              <ol className="grid gap-2.5">
                {recent.map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-3 text-[14px]">
                    <span className="w-16 shrink-0 font-mono text-[13px] text-muted-foreground" dir="ltr">
                      {planWhen(entry.at)}
                    </span>
                    <span className="min-w-0 truncate">
                      {entry.deviceName} <span className="text-muted-foreground">{auditAction(entry.action)}</span>
                      <span className="ms-1.5 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{sources[entry.source] ?? entry.source}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
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

function boardSummary(count: number, powered: number, offline: number, next: (DeviceView & { next: NonNullable<DeviceView["next"]> }) | undefined) {
  if (count === 0) return "אין עדיין שקעים בחשבון.";
  const running = powered === 0 ? "כל השקעים כבויים" : powered === 1 ? "שקע אחד פועל עכשיו" : `${powered} שקעים פועלים עכשיו`;
  const lost = offline === 0 ? "" : offline === 1 ? " · שקע אחד מנותק" : ` · ${offline} מנותקים`;
  const upcoming = next ? ` · ${next.name} ${next.next.action === "ON" ? "יידלק" : "יכבה"} ב־${planWhen(next.next.at)}` : "";
  return `${running}${lost}${upcoming}`;
}
