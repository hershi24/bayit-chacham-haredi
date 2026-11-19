"use client";

import { dayBars, type DayBar, type TimelineClock, type TimelineProgram } from "@/lib/programs/timeline";
import { cn } from "cn";

export type DayDevice = { deviceId: string; name: string; icon: string | null };

const COLORS = ["#1766e0", "#0c8f62", "#d4650a", "#6d28d9", "#be185d", "#0e7490", "#b45309", "#334155"];
const HOURS = [0, 6, 12, 18, 24];

function clock(minutes: number) {
  if (minutes >= 1440) return "24:00";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function colorFor(deviceId: string, devices: DayDevice[]) {
  const index = devices.findIndex((device) => device.deviceId === deviceId);
  if (index >= 0) return COLORS[index % COLORS.length];
  let hash = 0;
  for (const char of deviceId) hash = (hash + char.charCodeAt(0)) % COLORS.length;
  return COLORS[hash];
}

function place(bars: DayBar[]) {
  const sorted = [...bars].sort((left, right) => left.start - right.start || left.end - right.end);
  const ends: number[] = [];
  return sorted.map((bar) => {
    let lane = ends.findIndex((end) => end <= bar.start);
    if (lane < 0) {
      lane = ends.length;
      ends.push(bar.end);
    } else {
      ends[lane] = bar.end;
    }
    return { ...bar, lane, lanes: 0, laneCount: ends.length };
  }).map((bar, _, all) => ({ ...bar, laneCount: Math.max(...all.map((item) => item.lane)) + 1 }));
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
    ...known.map((device) => ({ ...device, bars: place(byDevice.get(device.deviceId) ?? []) })),
    ...[...byDevice.keys()]
      .filter((id) => !knownIds.has(id))
      .map((id) => ({ deviceId: id, name: id, icon: null, bars: place(byDevice.get(id) ?? []) })),
  ];
  const active = rows.filter((row) => row.bars.length > 0);
  const idle = rows.filter((row) => row.bars.length === 0);

  if (!active.length) {
    return <p className="px-2 py-8 text-center text-sm text-muted-foreground">אין הפעלות ביום זה.</p>;
  }

  return (
    <div className="rounded-xl border border-border/80 bg-card p-3">
      <div className="flex" dir="rtl">
        <div className="w-28 shrink-0" />
        <div className="flex min-w-0 flex-1 justify-between text-[10px] font-medium text-muted-foreground tabular-nums" dir="ltr">
          {HOURS.map((hour) => (
            <span key={hour}>{String(hour).padStart(2, "0")}</span>
          ))}
        </div>
      </div>
      <div>
        {active.map((row) => {
          const color = colorFor(row.deviceId, devices);
          const laneCount = row.bars[0]?.laneCount ?? 1;
          return (
            <div key={row.deviceId} className="flex items-stretch border-t border-border/60" dir="rtl">
              <div className="flex w-28 shrink-0 items-center gap-1.5 pe-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="min-w-0 truncate text-xs font-semibold">{row.name}</span>
              </div>
              <div className="relative min-w-0 flex-1" dir="ltr" style={{ height: Math.max(36, laneCount * 28 + 8) }}>
                {HOURS.map((hour) => (
                  <span key={hour} className="absolute inset-y-0 border-s border-border/50" style={{ left: `${(hour / 24) * 100}%` }} />
                ))}
                {row.bars.map((bar) => {
                      const wide = bar.end - bar.start >= 8 * 60;
                      return (
                        <button
                          key={bar.key}
                          type="button"
                          className={cn("absolute overflow-hidden rounded-md px-1 text-[10px] font-semibold text-white", bar.muted && "opacity-45")}
                      style={{
                        background: color,
                        top: 4 + bar.lane * 28,
                        height: 24,
                        left: `${(bar.start / 1440) * 100}%`,
                        width: `${((bar.end - bar.start) / 1440) * 100}%`,
                      }}
                      title={`${row.name} ${clock(bar.start)}–${clock(bar.end)} ${bar.name}${bar.muted ? " מושהית" : ""}`}
                      aria-label={`${row.name} ${clock(bar.start)} עד ${clock(bar.end)} ${bar.name}${bar.muted ? " מושהית" : ""}`}
                      onClick={() => onOpen(bar.source, bar.sourceId)}
                    >
                      {wide ? (
                        <span dir="ltr">
                          {clock(bar.start)}–{clock(bar.end)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {idle.length ? (
        <p className="border-t border-border/60 px-1 pt-2 text-xs text-muted-foreground">
          לא פועלים ביום זה: {idle.map((row) => row.name).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
