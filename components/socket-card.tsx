"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIsrael } from "@/lib/time";
import type { DeviceView, RelayAction } from "@/lib/types";

export function SocketCard({
  device,
  busy,
  showTenant,
  onCommand,
  onSimulate,
  mockMode,
}: {
  device: DeviceView;
  busy: RelayAction | null;
  showTenant: boolean;
  onCommand: (action: RelayAction) => void;
  onSimulate?: (patch: { relayOn?: boolean; online?: boolean }) => void;
  mockMode: boolean;
}) {
  const powered = device.relayOn === true;
  const offline = device.connectivity === "OFFLINE";
  const unknown = device.relayOn === null;
  const link =
    device.connectivity === "ONLINE" ? "מנוע מחובר" : device.connectivity === "OFFLINE" ? "מנוע מנותק" : "אין קריאה";
  const relayLabel = powered ? "פועל" : device.relayOn === false ? "כבוי" : "לא ידוע";

  return (
    <article className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">{device.name}</h2>
          {showTenant ? <p className="mt-0.5 truncate text-sm text-muted-foreground">{device.tenantName}</p> : null}
          <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
            {device.deviceId}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            powered ? "bg-online-soft text-online-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          <span className={`size-1.5 rounded-full ${powered ? "bg-online" : "bg-current opacity-40"}`} />
          {relayLabel}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className={`size-1.5 rounded-full ${offline ? "bg-destructive" : device.connectivity === "ONLINE" ? "bg-online" : "bg-muted-foreground"}`} />
        <span className={offline ? "text-destructive" : ""}>{link}</span>
        {device.deviceType ? <span className="text-muted-foreground">· {device.deviceType}</span> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">עודכן {formatIsrael(device.stateUpdatedAt)}</p>
      {device.sensorSummary ? <p className="mt-1 text-xs text-muted-foreground">{device.sensorSummary}</p> : null}
      {device.lastError ? <p className="mt-3 text-sm text-destructive">{device.lastError}</p> : null}

      <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
        <Button
          type="button"
          size="lg"
          variant={powered ? "default" : "outline"}
          className={`h-11 ${powered ? "bg-online text-white hover:bg-online/90" : ""}`}
          aria-pressed={powered}
          disabled={busy !== null}
          onClick={() => onCommand("ON")}
        >
          {busy === "ON" ? <Loader2 className="animate-spin" /> : null}
          הפעלה
        </Button>
        <Button
          type="button"
          size="lg"
          variant={!powered && !unknown ? "default" : "outline"}
          className="h-11"
          aria-pressed={device.relayOn === false}
          disabled={busy !== null}
          onClick={() => onCommand("OFF")}
        >
          {busy === "OFF" ? <Loader2 className="animate-spin" /> : null}
          כיבוי
        </Button>
      </div>
      {mockMode && onSimulate ? (
        <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => onSimulate({ relayOn: !powered })}>
            דימוי לחיצה פיזית
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onSimulate({ online: offline })}>
            {offline ? "דימוי חיבור מנוע" : "דימוי ניתוק מנוע"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
