"use client";

import { useState } from "react";
import { AirVent, Droplets, Fan, Heater, Lightbulb, Loader2, Plug, Power, Refrigerator, Timer, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DEVICE_ICONS, isDeviceIcon, suggestIcon, type DeviceIconKey } from "@/lib/devices/icons";
import "./power-switch.css";
import { formatIsrael, planWhen } from "@/lib/time";
import type { DeviceView, RelayAction } from "@/lib/types";

const ICONS: Record<DeviceIconKey, LucideIcon> = {
  socket: Plug,
  ac: AirVent,
  fan: Fan,
  light: Lightbulb,
  heat: Heater,
  boiler: Droplets,
  fridge: Refrigerator,
};

const PRESETS = [
  { minutes: 15, label: "15 דק׳" },
  { minutes: 30, label: "30 דק׳" },
  { minutes: 60, label: "שעה" },
  { minutes: 120, label: "שעתיים" },
];

export function SocketCard({
  device,
  busy,
  showTenant,
  onCommand,
  onSimulate,
  onIcon,
  onTimer,
  mockMode,
}: {
  device: DeviceView;
  busy: RelayAction | null;
  showTenant: boolean;
  onCommand: (action: RelayAction) => void;
  onSimulate?: (patch: { relayOn?: boolean; online?: boolean }) => void;
  onIcon: (icon: DeviceIconKey) => Promise<void>;
  onTimer: (input: { mode: "now" | "later"; time?: string; minutes: number }) => Promise<{ saved: boolean; message: string }>;
  mockMode: boolean;
}) {
  const powered = device.relayOn === true;
  const offline = device.connectivity === "OFFLINE";
  const frozen = device.frozen === true;
  const link = device.connectivity === "ONLINE" ? "מחובר" : offline ? "מנותק" : "אין קשר";
  const relayLabel = frozen ? "מוקפא" : powered ? "פועל" : device.relayOn === false ? "כבוי" : "לא ידוע";
  const iconKey = isDeviceIcon(device.icon) ? device.icon : suggestIcon(device.name);
  const Icon = ICONS[iconKey];
  const iconLabel = DEVICE_ICONS.find((item) => item.key === iconKey)?.label ?? "שקע";
  const [iconOpen, setIconOpen] = useState(false);
  const [picking, setPicking] = useState<DeviceIconKey | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [time, setTime] = useState("13:00");
  const [minutes, setMinutes] = useState("30");
  const [savingTimer, setSavingTimer] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);

  async function pickIcon(next: DeviceIconKey) {
    setPicking(next);
    setIconError(null);
    try {
      await onIcon(next);
      setIconOpen(false);
    } catch (error) {
      setIconError(error instanceof Error ? error.message : "שמירת האייקון נכשלה");
    } finally {
      setPicking(null);
    }
  }

  async function saveTimer() {
    const length = Number(minutes);
    if (!Number.isInteger(length) || length < 1 || length > 720) {
      setTimerError("משך הטיימר חייב להיות בין דקה ל-12 שעות");
      return;
    }
    if (mode === "later" && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
      setTimerError("השעה אינה תקינה");
      return;
    }
    setSavingTimer(true);
    setTimerError(null);
    try {
      const result = await onTimer({ mode, time: mode === "later" ? time : undefined, minutes: length });
      if (!result.saved) {
        setTimerError(result.message);
        return;
      }
      setTimerOpen(false);
    } catch (error) {
      setTimerError(error instanceof Error ? error.message : "הטיימר נכשל");
    } finally {
      setSavingTimer(false);
    }
  }

  return (
    <article className="flex h-full flex-col rounded-[22px] bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            type="button"
            variant="outline"
            className="size-11 shrink-0"
            aria-label={`אייקון ${iconLabel}`}
            onClick={() => {
              setIconError(null);
              setIconOpen(true);
            }}
          >
            <Icon className="size-5" />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold leading-[22px]">{device.name}</h2>
            {showTenant ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{device.tenantName}</p> : null}
            <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
              {device.deviceId}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            frozen ? "bg-muted text-muted-foreground" : powered ? "bg-online-soft text-online-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          <span className={`size-1.5 rounded-full ${!frozen && powered ? "bg-online" : "bg-current opacity-40"}`} />
          {relayLabel}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className={`size-1.5 rounded-full ${offline ? "bg-destructive" : device.connectivity === "ONLINE" ? "bg-online" : "bg-muted-foreground"}`} />
        <span className={offline ? "text-destructive" : ""}>{link}</span>
      </div>
      {device.next ? (
        <p className="mt-3 text-base font-medium">
          <span className="text-muted-foreground">הבא </span>
          <span dir="ltr">{planWhen(device.next.at)}</span>
          <span className={device.next.action === "ON" ? "text-online-foreground" : ""}>
            {" "}
            {device.next.action === "ON" ? "דולק" : "כבוי"}
          </span>
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">עודכן {formatIsrael(device.stateUpdatedAt)}</p>
      {device.sensorSummary && /\d/.test(device.sensorSummary) ? (
        <p className="mt-1 text-xs text-muted-foreground">{device.sensorSummary}</p>
      ) : null}
      {device.lastError ? <p className="mt-3 text-sm text-destructive">{device.lastError}</p> : null}
      {frozen ? <p className="mt-3 text-sm text-muted-foreground">ההתקן מוקפא. פנו למנהל.</p> : null}

      <div className="mt-auto flex flex-col items-center pt-5">
        <button
          type="button"
          className="power-switch"
          data-power=""
          data-frozen={frozen ? "" : undefined}
          data-state={powered ? "on" : device.relayOn === false ? "off" : "unknown"}
          aria-pressed={powered}
          aria-busy={busy !== null}
          aria-label={frozen ? `${device.name} מוקפא` : powered ? `כיבוי ${device.name}` : `הפעלה ${device.name}`}
          disabled={busy !== null || frozen}
          onClick={() => onCommand(powered ? "OFF" : "ON")}
        >
          <span className="power-switch-ring" aria-hidden="true" />
          <span className="power-switch-face">
            {busy !== null ? <Loader2 className="size-7 animate-spin" /> : <Power className="size-8" strokeWidth={2.25} />}
          </span>
        </button>
        <p className={`mt-2 text-[13px] font-medium ${!frozen && powered ? "text-online-foreground" : "text-muted-foreground"}`}>{relayLabel}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-11"
        disabled={busy !== null || savingTimer || frozen}
        onClick={() => {
          setTimerError(null);
          setTimerOpen(true);
        }}
      >
        <Timer />
        טיימר
      </Button>
      {mockMode && onSimulate ? (
        <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => onSimulate({ relayOn: !powered })}>
            דימוי לחיצה פיזית
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onSimulate({ online: offline })}>
            {offline ? "דימוי חיבור" : "דימוי ניתוק"}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={iconOpen}
        onOpenChange={(open) => {
          if (!open && picking) return;
          setIconOpen(open);
          if (!open) setIconError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>אייקון להתקן</DialogTitle>
            <DialogDescription>בחרו מהרשימה מה מחובר לשקע {device.name}.</DialogDescription>
          </DialogHeader>
          {iconError ? (
            <p role="alert" className="text-sm text-destructive">
              {iconError}
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {DEVICE_ICONS.map((item) => {
              const ItemIcon = ICONS[item.key];
              const selected = item.key === iconKey;
              return (
                <Button
                  key={item.key}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  className="h-16 flex-col gap-1"
                  aria-pressed={selected}
                  disabled={picking !== null}
                  onClick={() => void pickIcon(item.key)}
                >
                  {picking === item.key ? <Loader2 className="animate-spin" /> : <ItemIcon />}
                  {item.label}
                </Button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={timerOpen}
        onOpenChange={(open) => {
          if (!open && savingTimer) return;
          setTimerOpen(open);
          if (!open) setTimerError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTimer();
            }}
          >
            <DialogHeader>
              <DialogTitle>טיימר ל{device.name}</DialogTitle>
              <DialogDescription>הפעלה עכשיו או בשעה מאוחרת יותר, וכיבוי אחרי משך שתבחרו.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" className="h-11" variant={mode === "now" ? "default" : "outline"} onClick={() => setMode("now")}>
                עכשיו
              </Button>
              <Button type="button" className="h-11" variant={mode === "later" ? "default" : "outline"} onClick={() => setMode("later")}>
                מאוחר יותר
              </Button>
            </div>
            {mode === "later" ? (
              <label className="grid gap-1 text-sm">
                שעת הפעלה
                <Input
                  className="h-11 text-left"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="13:00"
                  pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                />
              </label>
            ) : null}
            <div className="grid gap-2">
              <p className="text-sm">למשך</p>
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.minutes}
                    type="button"
                    className="h-11 px-1"
                    variant={minutes === String(preset.minutes) ? "default" : "outline"}
                    onClick={() => setMinutes(String(preset.minutes))}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <label className="grid gap-1 text-sm">
                דקות
                <Input
                  className="h-11"
                  dir="ltr"
                  type="number"
                  min={1}
                  max={720}
                  inputMode="numeric"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                  required
                />
              </label>
            </div>
            {timerError ? (
              <p role="alert" className="text-sm text-destructive">
                {timerError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" className="h-11" disabled={savingTimer}>
                {savingTimer ? <Loader2 className="animate-spin" /> : null}
                {savingTimer ? "שומר…" : "שמירה"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  );
}
