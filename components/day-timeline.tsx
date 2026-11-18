"use client";

import { DeviceGlyph } from "@/components/device-glyph";
import { dayBars, type DayBar, type TimelineClock, type TimelineProgram } from "@/lib/programs/timeline";
import { cn } from "cn";

export type DayDevice = { deviceId: string; name: string; icon: string | null };

function clock(minutes: number) {
  if (minutes >= 1440) return "24:00";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function runsLabel(count: number) {
  return count === 1 ? "הפעלה אחת" : `${count} הפעלות`;
}

export function DayTimeline({
  day,
  programs,
  clocks,
  devices,
  filter,
  onOpen,
}: {
  day: string;
  programs: TimelineProgram[];
  clocks: TimelineClock[];
  devices: DayDevice[];
  filter: string;
  onOpen: (source: "program" | "clock", id: string) => void;
}) {
  const bars = dayBars(day, clocks, programs).filter((bar) => filter === "all" || bar.deviceId === filter);
  const byDevice = new Map<string, DayBar[]>();
  for (const bar of bars) {
    const list = byDevice.get(bar.deviceId) ?? [];
    list.push(bar);
    byDevice.set(bar.deviceId, list);
  }

  const known = devices.filter((device) => filter === "all" || device.deviceId === filter);
  const knownIds = new Set(known.map((device) => device.deviceId));
  const rows = [
    ...known.map((device) => ({ ...device, bars: (byDevice.get(device.deviceId) ?? []).sort(byStart) })),
    ...[...byDevice.keys()]
      .filter((id) => !knownIds.has(id))
      .map((id) => ({ deviceId: id, name: id, icon: null, bars: (byDevice.get(id) ?? []).sort(byStart) })),
  ];
  const active = rows.filter((row) => row.bars.length > 0);
  const idle = rows.filter((row) => row.bars.length === 0);

  if (!rows.length) {
    return <p className="px-2 py-8 text-center text-sm text-muted-foreground">אין התקנים להצגה ביום זה.</p>;
  }

  return (
    <div className="grid gap-2">
      {active.map((row) => (
        <article key={row.deviceId} className="rounded-xl border border-border/80 bg-card p-3">
          <header className="flex items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
              <DeviceGlyph name={row.name} icon={row.icon} className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold">{row.name}</h4>
              <p className="text-[11px] text-muted-foreground">{runsLabel(row.bars.length)}</p>
            </div>
          </header>
          <div className="relative mt-3 h-2 rounded-full bg-muted" dir="ltr" aria-hidden="true">
            {row.bars.map((bar) => (
              <span
                key={bar.key}
                className={cn("absolute inset-y-0 rounded-full", bar.muted ? "bg-muted-foreground/35" : "bg-primary")}
                style={{ left: `${(bar.start / 1440) * 100}%`, width: `${((bar.end - bar.start) / 1440) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums" dir="ltr">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
          <ul className="mt-2 grid gap-1">
            {row.bars.map((bar) => (
              <li key={bar.key}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-muted/70"
                  onClick={() => onOpen(bar.source, bar.sourceId)}
                >
                  <span className="shrink-0 text-sm font-semibold tabular-nums" dir="ltr">
                    {clock(bar.start)}–{clock(bar.end)}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-xs", bar.muted ? "text-muted-foreground" : "text-foreground/80")}>
                    {bar.name}
                    {bar.muted ? " · מושהית" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
      {(filter !== "all" || active.length === 0 ? idle : []).map((row) => (
        <article key={row.deviceId} className="rounded-xl border border-dashed border-border/80 bg-card p-3">
          <header className="flex items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <DeviceGlyph name={row.name} icon={row.icon} className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold">{row.name}</h4>
              <p className="text-[11px] text-muted-foreground">אין הפעלה ביום זה</p>
            </div>
          </header>
        </article>
      ))}
      {filter === "all" && active.length > 0 && idle.length > 0 ? (
        <p className="px-1 pt-1 text-xs leading-relaxed text-muted-foreground">
          לא פועלים ביום זה: {idle.map((row) => row.name).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function byStart(left: DayBar, right: DayBar) {
  return left.start - right.start || left.end - right.end;
}
