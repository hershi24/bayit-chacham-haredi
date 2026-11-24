"use client";

import { Pause, Pencil } from "lucide-react";
import { DeviceGlyph } from "@/components/device-glyph";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { PlannerClock, PlannerDevice, PlannerProgram } from "@/components/plan-dialog";
import { scheduledDays, type ScheduledDay } from "@/lib/programs/plan-view";
import { repeatCaption } from "@/lib/programs/weekdays";
import { cn } from "cn";

function actionWord(action: "ON" | "OFF") {
  return action === "ON" ? "הדלקה" : "כיבוי";
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
  onCancel,
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
  onCancel?: () => void;
}) {
  const title = program?.name ?? clock?.label ?? "שעון";
  const ids = program?.deviceIds ?? clock?.deviceIds ?? [];
  const skipped = program?.skippedDates ?? [];
  const days: ScheduledDay[] = program
    ? scheduledDays(
        program,
        clocks.filter((item) => !item.recurring && item.programId === program.id),
      )
    : clock
      ? scheduledDays(
          { weekdays: [], deviceIds: clock.deviceIds, slots: [] },
          [clock],
        )
      : [];
  const sharedDevices = new Set(days.flatMap((day) => day.actions.map((action) => action.deviceIds.join(",")))).size <= 1;
  const actionCount = days.reduce((sum, day) => sum + day.actions.length, 0);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-plan-view
        className="flex max-h-[min(92dvh,760px)] w-[min(28rem,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-md max-sm:!inset-x-0 max-sm:!top-auto max-sm:!bottom-0 max-sm:!h-auto max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-b-none max-sm:!rounded-t-2xl"
      >
        <div className="border-b px-5 pt-5 pb-4 pe-14">
          <DialogTitle className="text-lg leading-7 font-extrabold">{title}</DialogTitle>
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
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

          {days.length ? (
            <div>
              <p className="mb-2 text-[11px] font-bold tracking-wide text-muted-foreground">
                {actionCount === 1 ? "פעולה אחת" : `${actionCount} פעולות לפי סדר היום`}
              </p>
              <div className="space-y-3">
                {days.map((day) => (
                  <section key={day.key}>
                    <h4 className="mb-1.5 px-1 text-sm font-bold">{day.title}</h4>
                    <ul className="space-y-1.5">
                      {day.actions.map((item, index) => (
                        <li key={`${day.key}:${item.time}:${item.action}:${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/50 px-4 py-3">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{actionWord(item.action)}</span>
                            {sharedDevices ? null : (
                              <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">
                                {item.deviceIds
                                  .map((id) => devices.find((entry) => entry.deviceId === id)?.name ?? id)
                                  .join(" · ")}
                              </span>
                            )}
                          </span>
                          <span dir="ltr" className="shrink-0 text-sm font-semibold tabular-nums">
                            {item.time}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          ) : null}

          {program?.skipHolidays ? (
            <p className="text-xs leading-5 text-muted-foreground">לא פועלת בחגים. חנוכה ופורים נשארים ימי הפעלה.</p>
          ) : null}
          {skipped.length ? <p className="text-xs leading-5 text-muted-foreground">מושהה ב־{skipped.join(", ")}</p> : null}
        </div>

        <div className="flex flex-col gap-2 border-t bg-muted/30 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {program ? (
            <div className="flex items-center justify-between gap-2">
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
            </div>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-destructive/30 px-3 text-sm font-bold text-destructive"
              disabled={pending}
              onClick={onCancel}
            >
              ביטול התזמון
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-bold text-primary-foreground"
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
