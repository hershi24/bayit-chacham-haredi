"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListOrdered, Power, PowerOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SocketCard } from "@/components/socket-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { boardLine } from "@/lib/board-summary";
import { api } from "@/lib/client-api";
import type { DeviceIconKey } from "@/lib/devices/icons";
import { planWhen, seenWhen } from "@/lib/time";
import { auditSucceeded } from "@/lib/audit-result";
import type { AuditView, BridgeStatus, DeviceView, RelayAction, SessionUser } from "@/lib/types";
type Payload = { devices: DeviceView[]; status: BridgeStatus; user?: SessionUser };

export function Dashboard({ user }: { user?: SessionUser | null }) {
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [role, setRole] = useState<SessionUser["role"] | null>(user?.role ?? null);
  const [name, setName] = useState(user?.name ?? "");
  const [audit, setAudit] = useState<AuditView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, RelayAction | null>>({});
  const [bulkBusy, setBulkBusy] = useState<RelayAction | null>(null);
  const [live, setLive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<string[]>([]);
  const [focusTenant, setFocusTenant] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  // Desired relay while a click is still waiting on the device. A status report of the old
  // state arrives with a newer timestamp and would otherwise paint the switch back.
  const pendingRelay = useRef(new Map<string, boolean>());

  const applyDevice = useCallback((next: DeviceView) => {
    setDevices((current) => {
      // Live events can arrive before the first list; for an admin that would flash every tenant's devices.
      if (!current) return current;
      const index = current.findIndex((device) => device.deviceId === next.deviceId);
      if (index === -1) return [...current, next];
      const previous = current[index];
      const wanted = pendingRelay.current.get(next.deviceId);
      const merged: DeviceView = {
        ...next,
        relayOn: wanted === undefined ? next.relayOn : wanted,
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

  const refreshBoard = useCallback(async () => {
    setRefreshing(true);
    setRefreshNote("מתחיל לסנכרן את השקעים…");
    void loadAudit();
    try {
      let list = devices;
      if (!list) {
        const board = await api<Payload>("/api/devices");
        list = board.devices;
        setDevices(board.devices);
        setStatus(board.status);
      }
      if (focusTenant) list = list.filter((device) => device.tenantId === focusTenant);
      if (!list.length) {
        toast.message("אין שקעים לרענון");
        return;
      }

      const total = list.length;
      let done = 0;
      const active = new Map<string, string>();

      const paint = () => {
        const names = [...active.values()];
        setRefreshingIds([...active.keys()]);
        if (!names.length) {
          setRefreshNote(done >= total ? "מסיים את העדכון…" : `עודכנו ${done} מתוך ${total}`);
          return;
        }
        const head = names[0] ?? "שקע";
        const more = names.length > 1 ? ` ועוד ${names.length - 1}` : "";
        setRefreshNote(
          done === 0 ? `מרענן את ${head}${more}…` : `מרענן את ${head}${more} · ${done} מתוך ${total}`,
        );
      };
      paint();

      await Promise.all(
        list.map(async (device) => {
          const label = device.name.trim() || "שקע";
          active.set(device.deviceId, label);
          paint();
          try {
            const result = await api<{ device: DeviceView }>(
              `/api/devices/${encodeURIComponent(device.deviceId)}/refresh`,
              { method: "POST" },
            );
            applyDevice(result.device);
          } catch {
            // Continue other sockets; final list reload reconciles.
          } finally {
            active.delete(device.deviceId);
            done += 1;
            paint();
          }
        }),
      );

      setRefreshNote("מעדכן את הלוח…");
      const board = await api<Payload>("/api/devices");
      setDevices(board.devices);
      setStatus(board.status);
      setError(null);
      toast.success("מצב ההתקנים עודכן");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "הרענון נכשל";
      setError(message);
      toast.error(message);
    } finally {
      setRefreshing(false);
      setRefreshNote(null);
      setRefreshingIds([]);
    }
  }, [applyDevice, devices, focusTenant, loadAudit]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false).then(() => load(true)), 0);
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

  async function command(device: DeviceView, action: RelayAction, options?: { quiet?: boolean }) {
    const wanted = action === "ON";
    pendingRelay.current.set(device.deviceId, wanted);
    // Flip the switch color immediately so the tap feels instant.
    applyDevice({
      ...device,
      relayOn: wanted,
      stateUpdatedAt: new Date().toISOString(),
      lastError: null,
    });
    setBusy((current) => ({ ...current, [device.deviceId]: action }));
    try {
      const result = await api<{ device: DeviceView; status: string }>(`/api/devices/${device.deviceId}/commands`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      pendingRelay.current.delete(device.deviceId);
      applyDevice(result.device);
      if (options?.quiet) return result.status;
      const label = result.device.name?.trim() || device.name?.trim() || "השקע";
      if (result.status === "SUCCESS") {
        toast.success(action === "ON" ? `${label} הופעל בהצלחה` : `${label} נכבה בהצלחה`);
      } else if (result.status === "SENT") toast.message(`הפקודה ל${label} נשלחה וממתינה לאישור`);
      else toast.warning(`הפקודה ל${label} לא אושרה סופית. המצב שבכרטיס נקרא מההתקן`);
      return result.status;
    } catch (cause) {
      pendingRelay.current.delete(device.deviceId);
      if (!options?.quiet) toast.error(cause instanceof Error ? cause.message : "הפקודה נכשלה");
      if (!options?.quiet) await load(false);
      throw cause;
    } finally {
      pendingRelay.current.delete(device.deviceId);
      setBusy((current) => ({ ...current, [device.deviceId]: null }));
      if (!options?.quiet) void loadAudit();
    }
  }

  async function commandAll(action: RelayAction) {
    const pool = focusTenant ? (devices ?? []).filter((device) => device.tenantId === focusTenant) : devices ?? [];
    const needing = pool.filter((device) => {
      if (device.frozen) return false;
      return action === "ON" ? device.relayOn !== true : device.relayOn !== false;
    });
    const offlineSkipped = needing.filter((device) => device.connectivity === "OFFLINE").length;
    // Skip known-offline sockets so a hung WLTE call cannot starve later sockets.
    const targets = needing.filter((device) => device.connectivity !== "OFFLINE");
    if (!targets.length) {
      toast.message(
        offlineSkipped
          ? "אין שקעים מחוברים כעת"
          : action === "ON"
            ? "כל השקעים כבר פועלים"
            : "כל השקעים כבר כבויים",
      );
      return;
    }
    // Online before unknown so a slow unreachable socket cannot occupy the browser's
    // few connections to this host and starve the rest of the batch.
    const ordered = [...targets].sort((left, right) => {
      const leftRank = left.connectivity === "ONLINE" ? 0 : 1;
      const rightRank = right.connectivity === "ONLINE" ? 0 : 1;
      return leftRank - rightRank;
    });
    setBulkBusy(action);
    const results = await mapLimited(ordered, 4, (device) => command(device, action, { quiet: true }));
    const failed = results.filter((result) => result.status === "rejected").length;
    const ok = results.length - failed;
    if (failed === 0) {
      const offlineNote = offlineSkipped ? ` (מנותקים ${offlineSkipped} לא שונו)` : "";
      toast.success(action === "ON" ? `הופעלו ${ok} שקעים${offlineNote}` : `כובו ${ok} שקעים${offlineNote}`);
    } else if (ok === 0) {
      toast.error(action === "ON" ? "ההפעלה לכולם נכשלה" : "הכיבוי לכולם נכשל");
      await load(false);
    } else {
      const offlineNote = offlineSkipped ? `, מנותקים ${offlineSkipped}` : "";
      toast.warning(
        action === "ON" ? `הופעלו ${ok}, נכשלו ${failed}${offlineNote}` : `כובו ${ok}, נכשלו ${failed}${offlineNote}`,
      );
      await load(false);
    }
    setBulkBusy(null);
    void loadAudit();
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

  async function moveDevice(index: number, delta: number) {
    const list = focusTenant ? (devices ?? []).filter((device) => device.tenantId === focusTenant) : [...(devices ?? [])];
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= list.length) return;
    const ordered = [...list];
    const [item] = ordered.splice(index, 1);
    ordered.splice(nextIndex, 0, item);
    setDevices((current) => {
      if (!current) return current;
      if (!focusTenant) return ordered.map((device, sortOrder) => ({ ...device, sortOrder }));
      const others = current.filter((device) => device.tenantId !== focusTenant);
      return [...others, ...ordered.map((device, sortOrder) => ({ ...device, sortOrder }))];
    });
    try {
      const result = await api<{ devices: DeviceView[] }>("/api/devices/order", {
        method: "POST",
        body: JSON.stringify({
          deviceIds: ordered.map((device) => device.deviceId),
          tenantId: focusTenant || ordered[0]?.tenantId,
        }),
      });
      setDevices((current) => {
        if (!current) return result.devices;
        const byId = new Map(result.devices.map((device) => [device.deviceId, device]));
        return current.map((device) => byId.get(device.deviceId) ?? device);
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "שמירת הסדר נכשלה");
      await load(false);
    }
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

  const boardDevices =
    role === "admin" && focusTenant ? (devices ?? []).filter((device) => device.tenantId === focusTenant) : devices;
  const focusName = boardDevices?.[0]?.tenantName ?? "";
  const count = boardDevices?.length ?? 0;
  const connected = boardDevices?.filter((device) => device.connectivity === "ONLINE").length ?? 0;
  const running = boardDevices?.filter((device) => device.relayOn === true).length ?? 0;
  const upcoming = (boardDevices ?? [])
    .filter((device): device is DeviceView & { next: NonNullable<DeviceView["next"]> } => Boolean(device.next))
    .sort((a, b) => Date.parse(a.next.at) - Date.parse(b.next.at))
    .slice(0, 5);
  const recent = (audit ?? []).filter((entry) => entry.deviceName && auditSucceeded(entry.result)).slice(0, 5);
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

  const anyBusy = bulkBusy !== null || Object.values(busy).some(Boolean);
  const socketsBlock = (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium tracking-[0.08em] text-muted-foreground uppercase">השקעים</h2>
        {count > 0 ? (
          <div className="flex flex-wrap gap-2">
            {boardDevices && boardDevices.length > 1 ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 rounded-full"
                disabled={anyBusy}
                aria-label="סידור סדר התצוגה וההקראה"
                onClick={() => setOrderOpen(true)}
              >
                <ListOrdered className="size-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-full px-3.5 text-[13px]"
              disabled={anyBusy}
              onClick={() => void commandAll("ON")}
            >
              <Power className="size-3.5 text-online" />
              {bulkBusy === "ON" ? "מפעיל…" : "הפעל הכל"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-full px-3.5 text-[13px]"
              disabled={anyBusy}
              onClick={() => void commandAll("OFF")}
            >
              <PowerOff className="size-3.5 text-muted-foreground" />
              {bulkBusy === "OFF" ? "מכבה…" : "כבה הכל"}
            </Button>
          </div>
        ) : null}
      </div>
      {devices === null && !error ? <div className="h-28 animate-pulse rounded-2xl bg-muted" /> : null}
      {boardDevices && boardDevices.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-6 text-start">
          <h3 className="font-medium">אין שקעים משויכים לחשבון הזה</h3>
          <p className="mt-1 text-sm text-muted-foreground">מנהל המערכת יכול לשייך שקע ללקוח מתוך מסך הניהול.</p>
        </div>
      ) : null}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>סדר תצוגה והקראה</DialogTitle>
            <DialogDescription>הסדר כאן הוא גם הסדר בלוח וגם סדר ההקראה בטלפון.</DialogDescription>
          </DialogHeader>
          <ol className="-mx-1">
            {(boardDevices ?? []).map((device, index) => (
              <li key={device.deviceId} className="flex items-center gap-3 border-b border-border/50 px-1 py-2.5 last:border-b-0">
                <span className="w-5 text-[13px] tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[15px]">{device.name}</span>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  disabled={anyBusy || index === 0}
                  aria-label={`העלאת ${device.name}`}
                  onClick={() => void moveDevice(index, -1)}
                >
                  למעלה
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  disabled={anyBusy || index === (boardDevices?.length ?? 0) - 1}
                  aria-label={`הורדת ${device.name}`}
                  onClick={() => void moveDevice(index, 1)}
                >
                  למטה
                </button>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
      {boardDevices && boardDevices.length > 0 ? (
        <div className={deviceGrid}>
          {(boardDevices ?? []).map((device) => (
            <div
              key={device.deviceId}
              className={
                refreshingIds.includes(device.deviceId)
                  ? "rounded-2xl ring-1 ring-primary/25 transition-shadow duration-300"
                  : "transition-shadow duration-300"
              }
            >
              <SocketCard
                device={device}
                busy={busy[device.deviceId] ?? null}
                showTenant={false}
                mockMode={status?.mode === "mock" && role === "admin"}
                onCommand={(action) => void command(device, action)}
                onSimulate={(patch) => void simulate(device, patch)}
                onIcon={(icon) => chooseIcon(device, icon)}
                onName={(name) => renameDevice(device, name)}
                onTimer={(input) => armTimer(device, input)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="w-full min-w-0">
      <div className="mb-6 flex items-start justify-between gap-3">
        <p className="min-w-0 truncate pt-1.5 text-[13px] text-muted-foreground">{todayLabel()}</p>
        <div className="flex max-w-[min(100%,16rem)] flex-col items-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={refreshing}
            className="h-8 shrink-0 rounded-xl px-3 text-[13px] text-muted-foreground"
            onClick={() => void refreshBoard()}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "מרענן…" : "רענון"}
            <span className={`size-1.5 rounded-full ${live ? "bg-online" : "bg-muted-foreground/50"}`} aria-label={live ? "מחובר" : "מתחבר"} />
          </Button>
          {refreshing && refreshNote ? (
            <p className="text-end text-[12px] leading-4 text-muted-foreground" aria-live="polite">
              <span className="inline-block animate-pulse">{refreshNote}</span>
            </p>
          ) : null}
        </div>
      </div>
      <div>
        {role === "admin" && focusTenant ? (
          <button type="button" className="mb-2 text-[13px] font-medium text-primary" onClick={() => setFocusTenant(null)}>
            ← כל הלקוחות
          </button>
        ) : null}
        <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-balance sm:text-[32px]">
          {role === "admin" && !focusTenant
            ? "סקירת מערכת"
            : role === "admin" && focusTenant
              ? focusName || "לקוח"
              : `${greeting()}${name ? `, ${name}` : ""}`}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {role === "admin" && !focusTenant
            ? "לקוחות, חיבורים, ומה שדורש טיפול. שקעים נפתחים לפי לקוח."
            : devices
              ? boardLine(connected, running)
              : "טוען את מצב השקעים"}
        </p>
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

      {role === "admin" && !focusTenant ? (
        <div className="mt-8">
          {devices ? <AdminOverview devices={devices} onOpen={setFocusTenant} /> : <div className="h-28 animate-pulse rounded-2xl bg-muted" />}
        </div>
      ) : compactBoard ? (
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

function AdminOverview({ devices, onOpen }: { devices: DeviceView[]; onOpen: (tenantId: string) => void }) {
  const [query, setQuery] = useState("");
  const groups = new Map<string, { name: string; devices: DeviceView[] }>();
  for (const device of devices) {
    const group = groups.get(device.tenantId) ?? { name: device.tenantName || "לקוח", devices: [] };
    group.devices.push(device);
    groups.set(device.tenantId, group);
  }
  const needle = query.trim();
  const customers = [...groups.entries()]
    .map(([id, group]) => ({ id, ...group }))
    .filter((group) => !needle || group.name.includes(needle))
    .sort((left, right) => {
      const leftOff = left.devices.filter((device) => device.connectivity !== "ONLINE").length;
      const rightOff = right.devices.filter((device) => device.connectivity !== "ONLINE").length;
      if (leftOff !== rightOff) return rightOff - leftOff;
      return left.name.localeCompare(right.name, "he");
    });
  const offline = devices.filter((device) => device.connectivity !== "ONLINE").slice(0, 8);
  const online = devices.filter((device) => device.connectivity === "ONLINE").length;
  const running = devices.filter((device) => device.relayOn === true).length;

  return (
    <div className="grid gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="לקוחות" value={String(groups.size)} />
        <Stat label="מחוברים" value={String(online)} />
        <Stat label="לא מחוברים" value={String(devices.length - online)} />
        <Stat label="פועלים עכשיו" value={String(running)} />
      </div>
      {offline.length ? (
        <div>
          <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">דורש תשומת לב</h2>
          <ul className="overflow-hidden rounded-2xl border border-border/60 bg-card">
            {offline.map((device) => (
              <li key={device.deviceId} className="border-b border-border/50 last:border-b-0">
                <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-start" onClick={() => onOpen(device.tenantId)}>
                  <span className="size-2 shrink-0 rounded-full bg-destructive" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{device.name}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {device.tenantName} · נראה לאחרונה {seenWhen(device.lastOnlineAt ?? device.stateUpdatedAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-[14px] text-muted-foreground">כל ההתקנים מחוברים.</p>
      )}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[13px] font-medium text-muted-foreground">לקוחות</h2>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש לקוח"
            className="h-9 w-full max-w-xs rounded-xl border border-border bg-card px-3 text-[14px]"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {customers.map((customer) => {
            const up = customer.devices.filter((device) => device.connectivity === "ONLINE").length;
            const on = customer.devices.filter((device) => device.relayOn === true).length;
            return (
              <button
                key={customer.id}
                type="button"
                className="rounded-2xl border border-border/60 bg-card px-4 py-4 text-start hover:border-primary/40"
                onClick={() => onOpen(customer.id)}
              >
                <span className="block truncate text-[16px] font-semibold">{customer.name}</span>
                <span className="mt-1 block text-[13px] text-muted-foreground">
                  {customer.devices.length} התקנים · {up} מחוברים · {on} פועלים
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await work(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
