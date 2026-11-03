"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";
import type { MonthDay } from "@/lib/hebrew/calendar";
import { weekdayOf, weekdayPhrase } from "@/lib/programs/weekdays";
import type { TenantView } from "@/lib/types";
import { cn } from "cn";

type Clock = {
  id: string;
  day: string;
  hebrew: string;
  onTime: string | null;
  offTime: string | null;
  deviceIds: string[];
  programId: string | null;
  recurring: boolean;
};

type Program = {
  id: string;
  name: string;
  enabled: boolean;
  days: string[];
  weekdays: number[];
  onTime: string | null;
  offTime: string | null;
  deviceIds: string[];
};

type Board = {
  tenantId: string;
  locationId: string;
  places: Array<{ id: string; name: string }>;
  devices: Array<{ deviceId: string; name: string }>;
  programs: Program[];
  clocks: Clock[];
  month: { year: number; month: number; days: MonthDay[] };
};

type Picker = { tenants: TenantView[]; programs: null };

type Draft = {
  id: string | null;
  day: string;
  hebrew: string;
  onTime: string;
  offTime: string;
  deviceIds: string[];
  programId: string;
  repeat: "once" | "daily" | "weekdays";
  weekdays: number[];
  name: string;
  recurring: boolean;
};

type Selection = { id: string | null; name: string; days: string[] };

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "שבת"];
const TINTS = ["bg-amber-500/15", "bg-sky-500/15", "bg-emerald-500/15", "bg-violet-500/15"];
const fieldClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ProgramsBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [tenants, setTenants] = useState<TenantView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "list">("month");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selecting, setSelecting] = useState<Selection | null>(null);

  const load = useCallback(async (tenantId: string | null, year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (year) params.set("year", String(year));
    if (month) params.set("month", String(month));
    const query = params.toString();
    try {
      const payload = await api<Board | Picker>(`/api/programs${query ? `?${query}` : ""}`);
      if (!payload.programs) {
        setTenants(payload.tenants);
        setBoard(null);
        return;
      }
      setBoard(payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת הלוח נכשלה");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const clocksByDay = useMemo(() => {
    const grouped = new Map<string, Clock[]>();
    for (const clock of board?.clocks ?? []) {
      const list = grouped.get(clock.day) ?? [];
      list.push(clock);
      grouped.set(clock.day, list);
    }
    return grouped;
  }, [board]);

  async function send(body: Record<string, unknown>, key: string) {
    if (!board) return false;
    setPending(key);
    try {
      const payload = await api<Board>("/api/programs", {
        method: "POST",
        body: JSON.stringify({ ...body, tenantId: board.tenantId, year: board.month.year, month: board.month.month }),
      });
      setBoard(payload);
      setError(null);
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "השמירה נכשלה");
      return false;
    } finally {
      setPending(null);
    }
  }

  function openNew(day: MonthDay) {
    if (!board) return;
    const owners = board.programs.filter((program) => program.days.includes(day.date));
    setDraft({
      id: null,
      day: day.date,
      hebrew: day.hebrew,
      onTime: "",
      offTime: "",
      deviceIds: board.devices.length === 1 ? [board.devices[0].deviceId] : [],
      programId: owners.length === 1 ? owners[0].id : "",
      repeat: "once",
      weekdays: [day.weekday],
      name: "",
      recurring: false,
    });
  }

  function openClock(clock: Clock) {
    const program = clock.recurring ? board?.programs.find((item) => item.id === clock.programId) : undefined;
    setDraft({
      id: program?.id ?? clock.id,
      day: clock.day,
      hebrew: clock.hebrew,
      onTime: clock.onTime ?? "",
      offTime: clock.offTime ?? "",
      deviceIds: [...clock.deviceIds],
      programId: clock.programId ?? "",
      repeat: program ? (program.weekdays.length === 7 ? "daily" : "weekdays") : "once",
      weekdays: program ? [...program.weekdays] : [weekdayOf(clock.day)],
      name: program?.name ?? "",
      recurring: Boolean(program),
    });
  }

  function openRepeat(program: Program) {
    setDraft({
      id: program.id,
      day: "",
      hebrew: "",
      onTime: program.onTime ?? "",
      offTime: program.offTime ?? "",
      deviceIds: [...program.deviceIds],
      programId: program.id,
      repeat: program.weekdays.length === 7 ? "daily" : "weekdays",
      weekdays: [...program.weekdays],
      name: program.name,
      recurring: true,
    });
  }

  function toggleDay(date: string) {
    setSelecting((current) => {
      if (!current) return current;
      const days = current.days.includes(date) ? current.days.filter((item) => item !== date) : [...current.days, date].sort();
      return { ...current, days };
    });
  }

  function shiftMonth(delta: number) {
    if (!board) return;
    const cursor = new Date(Date.UTC(board.month.year, board.month.month - 1 + delta, 1));
    void load(board.tenantId, cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
  }

  function beginProgram(program?: Program) {
    if (program?.weekdays.length) {
      openRepeat(program);
      return;
    }
    setView("month");
    setSelecting(program ? { id: program.id, name: program.name, days: [...program.days] } : { id: null, name: "", days: [] });
    const first = program?.days[0];
    if (first && board) {
      const [year, month] = first.split("-").map(Number);
      if (year !== board.month.year || month !== board.month.month) void load(board.tenantId, year, month);
    }
  }

  async function saveProgram() {
    if (!selecting) return;
    const name = selecting.name.trim();
    if (!name) {
      toast.error("תנו שם לתוכנית");
      return;
    }
    if (!selecting.days.length) {
      toast.error("בחרו לפחות יום אחד בלוח");
      return;
    }
    const saved = await send({ action: "program-save", id: selecting.id, name, days: selecting.days }, "program");
    if (saved) setSelecting(null);
  }

  async function saveClock() {
    if (!draft) return;
    if (draft.repeat === "once") {
      if (!draft.day) {
        toast.error("בחרו תאריך");
        return;
      }
      const saved = await send(
        {
          action: "clock-save",
          id: draft.recurring ? null : draft.id,
          day: draft.day,
          onTime: draft.onTime,
          offTime: draft.offTime,
          deviceIds: draft.deviceIds,
          programId: draft.programId,
        },
        "clock",
      );
      if (saved) setDraft(null);
      return;
    }
    const weekdays = draft.repeat === "daily" ? [0, 1, 2, 3, 4, 5, 6] : draft.weekdays;
    if (!draft.name.trim()) {
      toast.error("תנו שם לתוכנית");
      return;
    }
    if (!weekdays.length) {
      toast.error("בחרו לפחות יום אחד בשבוע");
      return;
    }
    const saved = await send(
      {
        action: "repeat-save",
        id: draft.recurring ? draft.id : null,
        name: draft.name.trim(),
        weekdays,
        onTime: draft.onTime,
        offTime: draft.offTime,
        deviceIds: draft.deviceIds,
      },
      "clock",
    );
    if (saved) setDraft(null);
  }

  if (error && !board) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-destructive">{error}</p>
        <Button className="mt-4" type="button" onClick={() => void load(null)}>
          נסו שוב
        </Button>
      </section>
    );
  }

  if (!board && tenants) {
    return (
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">לוח שנה</h2>
        <p className="mt-1 text-sm text-muted-foreground">בחרו לקוח כדי לערוך את השעונים ואת התוכניות שלו.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {tenants.map((tenant) => (
            <button
              key={tenant.id}
              type="button"
              className="rounded-2xl border border-border bg-card px-4 py-3 text-start shadow-sm hover:bg-muted"
              onClick={() => void load(tenant.id)}
            >
              <span className="font-medium">{tenant.name}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (!board) return <p className="text-sm text-muted-foreground">טוען לוח…</p>;

  const title = new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(Date.UTC(board.month.year, board.month.month - 1, 15)));
  const listed = board.clocks.filter((clock) => !clock.recurring).sort(
    (left, right) => left.day.localeCompare(right.day) || (left.onTime ?? "").localeCompare(right.onTime ?? ""),
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => shiftMonth(-1)}>
            הקודם
          </Button>
          <h2 className="min-w-28 text-center text-xl font-semibold tracking-tight">{title}</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => shiftMonth(1)}>
            הבא
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tenants ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setBoard(null)}>
              לקוח אחר
            </Button>
          ) : null}
          <select
            className={cn(fieldClass, "w-auto")}
            aria-label="עיר לזמני היום"
            value={board.locationId}
            onChange={(event) => void send({ action: "location", locationId: event.target.value }, "location")}
          >
            {board.places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" variant={view === "month" ? "default" : "outline"} onClick={() => setView("month")}>
            לוח
          </Button>
          <Button type="button" size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}>
            רשימה
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        לחצו + כדי להוסיף שעון ליום, ואפשר לבחור כמה שקעים. בחזרה אפשר כל יום, או ימים בשבוע, ולשמור את זה כתוכנית. נרות והבדלה מוצגים לידיעה.
      </p>

      {selecting ? (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-primary/40 bg-primary/5 p-3">
          <p className="w-full text-sm">בחרו ימים בלוח. נבחרו {selecting.days.length}.</p>
          <Label className="min-w-48 flex-1 flex-col items-stretch gap-1">
            שם התוכנית
            <Input
              value={selecting.name}
              maxLength={40}
              onChange={(event) => {
                const name = event.target.value;
                setSelecting((current) => (current ? { ...current, name } : current));
              }}
            />
          </Label>
          <Button type="button" disabled={pending === "program"} onClick={() => void saveProgram()}>
            שמירה
          </Button>
          <Button type="button" variant="outline" onClick={() => setSelecting(null)}>
            ביטול
          </Button>
        </div>
      ) : null}

      {view === "month" ? (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-border bg-border">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="bg-muted px-1 py-1.5 text-center text-xs font-medium">
              {weekday}
            </div>
          ))}
          {board.month.days.map((day) => {
            const pickedIndex = board.programs.findIndex((item) => item.days.includes(day.date));
            const weekIndex = board.programs.findIndex((item) => item.weekdays.includes(day.weekday));
            const programIndex = pickedIndex >= 0 ? pickedIndex : weekIndex;
            const program = programIndex >= 0 ? board.programs[programIndex] : undefined;
            const chosen = selecting?.days.includes(day.date) ?? false;
            const clocks = clocksByDay.get(day.date) ?? [];
            return (
              <div
                key={day.date}
                data-date={day.date}
                className={cn(
                  "flex min-h-24 flex-col gap-0.5 bg-card p-1 text-[11px] sm:min-h-32 sm:p-1.5",
                  !day.inMonth && "bg-muted/50 text-muted-foreground",
                  program && TINTS[programIndex % TINTS.length],
                  chosen && "ring-2 ring-primary ring-inset",
                  selecting && "cursor-pointer",
                )}
                onClick={() => {
                  if (selecting) toggleDay(day.date);
                }}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="font-semibold">{day.day}</span>
                  <span className="text-end text-[9px] leading-tight text-muted-foreground sm:text-[10px]">{day.hebrew}</span>
                </div>
                {day.parsha ? <p className="font-semibold leading-tight text-primary">{day.parsha}</p> : null}
                {day.holiday ? <p className="line-clamp-2 leading-tight">{day.holiday}</p> : null}
                {day.candles ? <p className="text-[10px] text-muted-foreground">נרות {day.candles}</p> : null}
                {day.havdalah ? <p className="text-[10px] text-muted-foreground">הבדלה {day.havdalah}</p> : null}
                {clocks.map((clock) => {
                  const owner = board.programs.find((item) => item.id === clock.programId);
                  const paused = Boolean(owner && !owner.enabled);
                  return (
                    <button
                      key={clock.id}
                      type="button"
                      className={cn(
                        "rounded bg-background/80 px-1 py-0.5 text-start leading-tight hover:bg-background",
                        paused && "opacity-50 line-through",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        openClock(clock);
                      }}
                    >
                      <ClockFace clock={clock} />
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-label={`הוספת שעון ב-${day.date}`}
                  className="mt-auto size-6 self-start rounded-full border border-border bg-background text-sm leading-none hover:bg-muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    openNew(day);
                  }}
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {listed.length || board.programs.some((program) => program.weekdays.length) ? (
            <ul>
              {board.programs
                .filter((program) => program.weekdays.length)
                .map((program) => (
                  <li key={program.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-sm">
                    <span className="font-medium">{program.name}</span>
                    <span>{weekdayPhrase(program.weekdays)}</span>
                    <span dir="ltr">{[program.onTime, program.offTime].filter(Boolean).join("–")}</span>
                    <span className="text-muted-foreground">{deviceNames(board, program.deviceIds)}</span>
                    <span className="text-muted-foreground">{program.enabled ? "פועלת" : "כבויה"}</span>
                    <span className="ms-auto flex gap-1">
                      <Button type="button" size="xs" variant="outline" onClick={() => openRepeat(program)}>
                        עריכה
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        onClick={() => {
                          if (window.confirm("למחוק את התוכנית?")) void send({ action: "program-delete", id: program.id }, program.id);
                        }}
                      >
                        מחיקה
                      </Button>
                    </span>
                  </li>
                ))}
              {listed.map((clock) => {
                const program = board.programs.find((item) => item.id === clock.programId);
                return (
                  <li key={clock.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-sm last:border-0">
                    <span className="font-medium">{prettyDay(clock.day)}</span>
                    <span className="text-muted-foreground">{clock.hebrew}</span>
                    <ClockFace clock={clock} />
                    <span className="text-muted-foreground">{deviceNames(board, clock.deviceIds)}</span>
                    <span>{program ? program.name : "בלי תוכנית"}</span>
                    <span className="ms-auto flex gap-1">
                      <Button type="button" size="xs" variant="outline" onClick={() => openClock(clock)}>
                        עריכה
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        onClick={() => {
                          if (window.confirm("למחוק את השעון?")) void send({ action: "clock-delete", id: clock.id }, clock.id);
                        }}
                      >
                        מחיקה
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">אין עדיין שעונים. בלוח, לחצו + על היום.</p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">תוכניות</h3>
          <Button type="button" size="sm" onClick={() => beginProgram()} disabled={Boolean(selecting)}>
            תוכנית חדשה
          </Button>
        </div>
        {board.programs.length ? (
          <div className="grid gap-2">
            {board.programs.map((program, index) => (
              <article key={program.id} className={cn("rounded-2xl border border-border p-3", TINTS[index % TINTS.length])}>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-medium">{program.name}</h4>
                  <span className="text-xs text-muted-foreground">{program.enabled ? "פועלת" : "כבויה"}</span>
                  <span className="ms-auto flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant={program.enabled ? "secondary" : "default"}
                      disabled={pending === program.id}
                      onClick={() => void send({ action: "program-toggle", id: program.id }, program.id)}
                    >
                      {program.enabled ? "כיבוי" : "הפעלה"}
                    </Button>
                    <Button type="button" size="xs" variant="outline" onClick={() => beginProgram(program)}>
                      עריכה
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm("למחוק את התוכנית ואת השעונים שלה?")) {
                          void send({ action: "program-delete", id: program.id }, program.id);
                        }
                      }}
                    >
                      מחיקה
                    </Button>
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {program.weekdays.length ? (
                    <>
                      {weekdayPhrase(program.weekdays)}
                      {program.onTime || program.offTime ? (
                        <span dir="ltr"> · {[program.onTime, program.offTime].filter(Boolean).join("–")}</span>
                      ) : null}
                    </>
                  ) : (
                    program.days.map(prettyDay).join(" · ") || "אין ימים"
                  )}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">אין תוכניות. תוכנית היא כמה ימים בלוח, או חזרה לפי ימים בשבוע.</p>
        )}
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.recurring || draft.id ? "עריכת שעון" : "שעון חדש"}</DialogTitle>
                <DialogDescription>
                  {draft.repeat === "once" ? `${prettyDay(draft.day)} ${draft.hebrew}` : weekdayPhrase(draft.repeat === "daily" ? [0, 1, 2, 3, 4, 5, 6] : draft.weekdays) || "בחרו ימים"}
                </DialogDescription>
              </DialogHeader>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">חזרה</legend>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ["once", "פעם אחת"],
                      ["daily", "כל יום"],
                      ["weekdays", "ימים בשבוע"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="xs"
                      variant={draft.repeat === value ? "default" : "outline"}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          repeat: value,
                          weekdays: value === "daily" ? [0, 1, 2, 3, 4, 5, 6] : draft.weekdays.length ? draft.weekdays : [draft.day ? weekdayOf(draft.day) : 0],
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {draft.repeat === "weekdays" ? (
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((label, index) => {
                      const selected = draft.weekdays.includes(index);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={selected}
                          className={cn(
                            "size-8 rounded-full border border-border text-sm",
                            selected ? "bg-primary text-primary-foreground" : "bg-background",
                          )}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              weekdays: selected ? draft.weekdays.filter((day) => day !== index) : [...draft.weekdays, index].sort(),
                            })
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {draft.repeat === "daily" ? (
                  <p className="text-xs text-muted-foreground">כולל שישי ושבת. בלי הימים האלה בחרו ימים בשבוע וסמנו א עד ה.</p>
                ) : null}
              </fieldset>
              {draft.repeat === "once" ? (
                <Label className="flex-col items-stretch gap-1">
                  תאריך
                  <Input dir="ltr" type="date" value={draft.day} onChange={(event) => setDraft({ ...draft, day: event.target.value })} />
                </Label>
              ) : (
                <Label className="flex-col items-stretch gap-1">
                  שם התוכנית
                  <Input
                    value={draft.name}
                    maxLength={40}
                    placeholder="למשל מזגן"
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </Label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Label className="flex-col items-stretch gap-1">
                  הדלקה
                  <Input dir="ltr" type="time" value={draft.onTime} onChange={(event) => setDraft({ ...draft, onTime: event.target.value })} />
                </Label>
                <Label className="flex-col items-stretch gap-1">
                  כיבוי
                  <Input dir="ltr" type="time" value={draft.offTime} onChange={(event) => setDraft({ ...draft, offTime: event.target.value })} />
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">אם הכיבוי מוקדם מההדלקה, הוא יתבצע ביום שלמחרת.</p>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">שקעים</legend>
                {board.devices.length ? (
                  board.devices.map((device) => (
                    <label key={device.deviceId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.deviceIds.includes(device.deviceId)}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            deviceIds: draft.deviceIds.includes(device.deviceId)
                              ? draft.deviceIds.filter((id) => id !== device.deviceId)
                              : [...draft.deviceIds, device.deviceId],
                          })
                        }
                      />
                      {device.name}
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">אין שקעים משויכים ללקוח.</p>
                )}
              </fieldset>
              {draft.repeat === "once" ? (
              <Label className="flex-col items-stretch gap-1">
                תוכנית
                <select
                  className={fieldClass}
                  value={draft.programId}
                  onChange={(event) => setDraft({ ...draft, programId: event.target.value })}
                >
                  <option value="">בלי תוכנית</option>
                  {board.programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                    </option>
                  ))}
                </select>
              </Label>
              ) : null}
              <DialogFooter>
                {draft.id ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      if (!draft.id || !window.confirm("למחוק את השעון?")) return;
                      void send(
                        draft.recurring ? { action: "program-delete", id: draft.id } : { action: "clock-delete", id: draft.id },
                        "clock",
                      ).then((saved) => {
                        if (saved) setDraft(null);
                      });
                    }}
                  >
                    מחיקה
                  </Button>
                ) : null}
                <Button type="button" disabled={pending === "clock"} onClick={() => void saveClock()}>
                  שמירה
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ClockFace({ clock }: { clock: Clock }) {
  if (clock.onTime && clock.offTime) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span dir="ltr">{clock.onTime}–{clock.offTime}</span>
        {clock.offTime <= clock.onTime ? <span>למחרת</span> : null}
      </span>
    );
  }
  if (clock.onTime) {
    return (
      <span>
        הדלקה <span dir="ltr">{clock.onTime}</span>
      </span>
    );
  }
  return (
    <span>
      כיבוי <span dir="ltr">{clock.offTime}</span>
    </span>
  );
}

function prettyDay(iso: string) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year.slice(2)}`;
}

function deviceNames(board: Board, ids: string[]) {
  const names = ids.map((id) => board.devices.find((device) => device.deviceId === id)?.name ?? id);
  return names.join(", ");
}
