"use client";

import { Pause, Pencil } from "lucide-react";
import { DeviceGlyph } from "@/components/device-glyph";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { PlannerClock, PlannerDevice, PlannerProgram } from "@/components/plan-dialog";
import { repeatCaption } from "@/lib/programs/weekdays";
import { cn } from "cn";

export function PlanViewDialog({
  program,
  clock,
  clocks = [],
  devices,
  pending,
  onClose,
  onEdit,
  onToggle,
  onPause,
}: {
  program: PlannerProgram | null;
  clock: PlannerClock | null;
  clocks?: PlannerClock[];
  devices: PlannerDevice[];
  pending: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggle?: () => void;
  onPause?: () => void;
}) {
  const title = program?.name ?? "שעון";
  const ids = program?.deviceIds ?? clock?.deviceIds ?? [];
  const skipped = program?.skippedDates ?? [];
  const owned = program ? clocks.filter((item) => !item.recurring && item.programId === program.id) : [];
  const times = program
    ? program.weekdays.length
      ? program.slots.map((slot) => `${slot.onTime ?? "--:--"}–${slot.offTime ?? "--:--"}`).join(" · ")
      : owned.map((item) => `${item.day} ${item.onTime ?? "--:--"}–${item.offTime ?? "--:--"}`).join(" · ")
    : `${clock?.day ?? ""} ${clock?.onTime ?? "--:--"}–${clock?.offTime ?? "--:--"}`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="truncate">{title}</DialogTitle>
            <DialogDescription>
              {program
                ? repeatCaption({
                    weekdays: program.weekdays,
                    startDate: program.startDate,
                    endDate: program.endDate,
                    days: program.days,
                  })
                : clock?.day}
            </DialogDescription>
          </div>
          <button
            type="button"
            className="grid size-10 shrink-0 place-items-center rounded-xl border bg-card text-primary"
            aria-label="עריכת התוכנית"
            onClick={onEdit}
          >
            <Pencil className="size-4" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {ids.map((id) => {
            const device = devices.find((item) => item.deviceId === id);
            return (
              <span key={id} className="inline-flex items-center gap-2 rounded-full border bg-secondary/70 px-3 py-1.5 text-sm">
                <DeviceGlyph name={device?.name ?? id} icon={device?.icon} className="size-4" />
                {device?.name ?? id}
              </span>
            );
          })}
        </div>
        {times ? (
          <p className="mt-4 rounded-xl bg-muted/60 px-3 py-2 text-sm" dir="ltr">
            {times}
          </p>
        ) : null}
        {program ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm font-bold">
              <span className={cn("relative h-6 w-11 rounded-full transition-colors", program.enabled ? "bg-online" : "bg-muted-foreground/40")}>
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={program.enabled}
                  disabled={pending}
                  aria-label={program.enabled ? "כיבוי התוכנית" : "הדלקת התוכנית"}
                  onChange={() => onToggle?.()}
                />
                <span
                  className={cn(
                    "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[inset-inline-start]",
                    program.enabled ? "start-5" : "start-0.5",
                  )}
                />
              </span>
              {program.enabled ? "פעילה" : "כבויה"}
            </label>
            <button type="button" className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold" onClick={onPause}>
              <Pause className="size-3.5" />
              השהיה{skipped.length ? ` (${skipped.length})` : ""}
            </button>
          </div>
        ) : null}
        {skipped.length ? <p className="mt-3 text-xs text-muted-foreground">מושהה ב־{skipped.join(", ")}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
