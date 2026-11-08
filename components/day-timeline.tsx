"use client";

import { dayBars, laneBars, type TimelineClock, type TimelineProgram } from "@/lib/programs/timeline";
import { cn } from "cn";

const HOURS = 25;
const HOUR = 28;

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
    <div className="overflow-x-auto py-1">
      <div className="flex min-w-[260px]">
        <div className="relative w-10 shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums" style={{ height }}>
          {Array.from({ length: HOURS }, (_, hour) => (
            <div key={hour} className="absolute inset-x-0 -translate-y-1/2 leading-none" style={{ top: hour * HOUR }}>
              {pad(hour)}
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 rounded-lg border border-border/70 bg-muted/20" style={{ height }}>
          {Array.from({ length: HOURS }, (_, hour) => (
            <div key={hour} className="absolute inset-x-0 border-t border-border/50" style={{ top: hour * HOUR }} />
          ))}
          {bars.map((bar) => {
            const top = (bar.start / 60) * HOUR;
            const span = Math.max(((bar.end - bar.start) / 60) * HOUR, 16);
            const width = `calc((100% - 0.5rem) / ${lanes})`;
            const long = bar.end - bar.start >= 8 * 60;
            return (
              <button
                key={bar.key}
                type="button"
                title={bar.title}
                className={cn(
                  "absolute overflow-hidden rounded-md px-1.5 py-0.5 text-start text-[10px] font-semibold leading-tight",
                  bar.muted
                    ? "border border-dashed border-border bg-muted/60 text-muted-foreground"
                    : long
                      ? "border border-primary/25 bg-primary/10 text-foreground"
                      : "border border-primary/30 bg-primary/15 text-foreground",
                )}
                style={{
                  top,
                  height: span,
                  width,
                  insetInlineStart: `calc(0.25rem + ((100% - 0.5rem) / ${lanes}) * ${bar.lane})`,
                }}
                onClick={() => onOpen(bar.source, bar.sourceId)}
              >
                <span className="block truncate">{bar.name}</span>
                {!long ? (
                  <span className="block font-medium text-muted-foreground" dir="ltr">
                    {bar.title.replace(`${bar.name} `, "")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
