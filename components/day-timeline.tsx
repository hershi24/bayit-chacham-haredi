"use client";

import { dayBars, laneBars, type TimelineClock, type TimelineProgram } from "@/lib/programs/timeline";
import { cn } from "cn";

const HOURS = 25;
const HOUR = 44;

function pad(value: number) {
  return `${String(value).padStart(2, "0")}:00`;
}

export function DayTimeline({
  day,
  programs,
  clocks,
  filter,
  onOpen,
}: {
  day: string;
  programs: TimelineProgram[];
  clocks: TimelineClock[];
  filter: string;
  onOpen: (source: "program" | "clock", id: string) => void;
}) {
  const bars = laneBars(dayBars(day, clocks, programs)).filter((bar) => filter === "all" || bar.deviceId === filter);
  const lanes = Math.max(1, ...bars.map((bar) => bar.lane + 1), 1);
  const height = (HOURS - 1) * HOUR;

  return (
    <div className="overflow-x-auto p-3">
      <div className="flex min-w-[280px]">
        <div className="relative w-12 shrink-0 text-[11px] font-bold text-muted-foreground" style={{ height }}>
          {Array.from({ length: HOURS }, (_, hour) => (
            <div key={hour} className="absolute inset-x-0 -translate-y-1/2 leading-none" style={{ top: hour * HOUR }}>
              {pad(hour)}
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 rounded-xl border bg-muted/30" style={{ height }}>
          {Array.from({ length: HOURS }, (_, hour) => (
            <div key={hour} className="absolute inset-x-0 border-t border-border/70" style={{ top: hour * HOUR }} />
          ))}
          {bars.map((bar) => {
            const top = (bar.start / 60) * HOUR;
            const span = Math.max(((bar.end - bar.start) / 60) * HOUR, 22);
            const width = `calc((100% - 0.75rem) / ${lanes})`;
            return (
              <button
                key={bar.key}
                type="button"
                title={bar.title}
                className={cn(
                  "absolute overflow-hidden rounded-lg px-2 py-1 text-start text-[11px] font-bold shadow-sm",
                  bar.muted ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
                )}
                style={{
                  top,
                  height: span,
                  width,
                  insetInlineStart: `calc(0.35rem + ((100% - 0.75rem) / ${lanes}) * ${bar.lane})`,
                }}
                onClick={() => onOpen(bar.source, bar.sourceId)}
              >
                <span className="block truncate">{bar.name}</span>
                <span className="block font-medium opacity-90" dir="ltr">
                  {bar.title.replace(`${bar.name} `, "")}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
