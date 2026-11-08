"use client";

import { Pause, Pencil } from "lucide-react";
import { DeviceGlyph } from "@/components/device-glyph";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { PlannerClock, PlannerDevice, PlannerProgram } from "@/components/plan-dialog";
import { repeatCaption } from "@/lib/programs/weekdays";
import { cn } from "cn";

function slotLabel(onTime: string | null | undefined, offTime: string | null | undefined) {
  const on = onTime || null;
  const off = offTime || null;
  if (on && off) return `${on}–${off}`;
  if (on) return `הדלקה ב־${on}`;
  if (off) return `כיבוי ב־${off}`;
  return null;
}

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
  const rows = program
    ? program.weekdays.length
      ? program.slots
          .map((slot) => slotLabel(slot.onTime, slot.offTime))
          .filter((item): item is string => Boolean(item))
      : owned
          .map((item) => {
            const hours = slotLabel(item.onTime, item.offTime);
            return hours ? `${item.day} · ${hours}` : null;
          })
          .filter((item): item is string => Boolean(item))
    : (() => {
        const hours = slotLabel(clock?.onTime, clock?.offTime);
        if (!hours) return [] as string[];
        return clock?.day ? [`${clock.day} · ${hours}`] : [hours];
      })();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="border-b px-5 pb-4 pt-5 pe-14">
          <DialogTitle className="text-lg font-extrabold leading-7">{title}</DialogTitle>
          <DialogDescription className="mt-1.5 text-[13px] leading-6">
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

        <div className="space-y-4 px-5 py-4">
          {ids.length ? (
            <div>
              <p className="mb-2 text-[11px] font-bold tracking-wide text-muted-foreground">שקעים</p>
              <div className="flex flex-wrap gap-2">
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
            </div>
          ) : null}

          {rows.length ? (
            <div>
              <p className="mb-2 text-[11px] font-bold tracking-wide text-muted-foreground">שעות</p>
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row} className="rounded-xl bg-muted/60 px-3 py-2.5 text-sm font-medium" dir="ltr">
                    {row}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {skipped.length ? <p className="text-xs leading-5 text-muted-foreground">מושהה ב־{skipped.join(", ")}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
          {program ? (
            <>
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
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-bold"
                onClick={onPause}
              >
                <Pause className="size-3.5" />
                השהיה{skipped.length ? ` (${skipped.length})` : ""}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ms-auto inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-bold text-primary-foreground"
            onClick={onEdit}
          >
            <Pencil className="size-4" />
            עריכה
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
