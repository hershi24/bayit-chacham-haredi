"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
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
import { dayBars, laneBars } from "@/lib/programs/timeline";
import { weekdayOf, weekdayPhrase } from "@/lib/programs/weekdays";
import { israelDate, shiftDate } from "@/lib/time";
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
  slots: Slot[];
  deviceIds: string[];
};

type Slot = { onTime: string | null; offTime: string | null };

type DraftSlot = { key: number; onTime: string; offTime: string };

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
  slots: DraftSlot[];
  deviceIds: string[];
  programId: string;
  repeat: "once" | "daily" | "weekdays";
  weekdays: number[];
  name: string;
  recurring: boolean;
};

type Selection = { id: string | null; name: string; days: string[] };

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "שבת"];
const WEEKDAY_CHIPS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];
const DAY_NAMES = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
const BAR_COLORS = ["#d97706", "#0284c7", "#059669", "#7c3aed", "#e11d48", "#0f766e"];
const TINTS = ["bg-amber-500/15", "bg-sky-500/15", "bg-emerald-500/15", "bg-violet-500/15"];
const fieldClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ProgramsBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [tenants, setTenants] = useState<TenantView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "list" | "hours">("month");
  const [cursor, setCursor] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
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
      const message = cause instanceof Error ? cause.message : "השמירה נכשלה";
      setFormError(message);
      toast.error(message);
      return false;
    } finally {
      setPending(null);
    }
  }

  function updateDraft(recipe: (current: Draft) => Draft) {
    setFormError(null);
    setDraft((current) => (current ? recipe(current) : current));
  }

  function editSlot(key: number, patch: Partial<DraftSlot>) {
    updateDraft((current) => ({
      ...current,
      slots: current.slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)),
    }));
  }

  function openNew(day: MonthDay) {
    if (!board) return;
    const owners = board.programs.filter((program) => program.days.includes(day.date));
    setFormError(null);
    setDraft({
      id: null,
      day: day.date,
      hebrew: day.hebrew,
      slots: [blankSlot()],
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
    setFormError(null);
    setDraft({
      id: program?.id ?? clock.id,
      day: clock.day,
      hebrew: clock.hebrew,
      slots: program ? draftSlots(program) : [blankSlot(clock)],
      deviceIds: [...clock.deviceIds],
      programId: clock.programId ?? "",
      repeat: program ? (program.weekdays.length === 7 ? "daily" : "weekdays") : "once",
      weekdays: program ? [...program.weekdays] : [weekdayOf(clock.day)],
      name: program?.name ?? "",
      recurring: Boolean(program),
    });
  }

  function openRepeat(program: Program) {
    setFormError(null);
    setDraft({
      id: program.id,
      day: "",
      hebrew: "",
      slots: draftSlots(program),
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
    const next = new Date(Date.UTC(board.month.year, board.month.month - 1 + delta, 1));
    void load(board.tenantId, next.getUTCFullYear(), next.getUTCMonth() + 1);
  }

  function ensureMonth(day: string) {
    if (!board) return;
    const [year, month] = day.split("-").map(Number);
    if (year !== board.month.year || month !== board.month.month) void load(board.tenantId, year, month);
  }

  function shiftDay(delta: number) {
    const next = shiftDate(cursor || israelDate(), delta);
    setCursor(next);
    ensureMonth(next);
  }

  function showHours() {
    const day = cursor || israelDate();
    setCursor(day);
    setView("hours");
    ensureMonth(day);
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
        setFormError("בחרו תאריך");
        return;
      }
      const [slot] = draft.slots;
      if (!slot?.onTime && !slot?.offTime) {
        setFormError("בחרו שעת הדלקה או כיבוי");
        return;
      }
      if (!draft.deviceIds.length) {
        setFormError("בחרו לפחות שקע אחד");
        return;
      }
      setFormError(null);
      const saved = await send(
        {
          action: "clock-save",
          id: draft.recurring ? null : draft.id,
          day: draft.day,
          onTime: slot.onTime,
          offTime: slot.offTime,
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
      setFormError("תנו שם לתוכנית");
      return;
    }
    if (!weekdays.length) {
      setFormError("בחרו לפחות יום אחד בשבוע");
      return;
    }
    const slots = draft.slots
      .filter((slot) => slot.onTime || slot.offTime)
      .map((slot) => ({ onTime: slot.onTime, offTime: slot.offTime }));
    if (!slots.length) {
      setFormError("הוסיפו לפחות שעון אחד עם שעת הדלקה או כיבוי");
      return;
    }
    if (!draft.deviceIds.length) {
      setFormError("בחרו לפחות שקע אחד");
      return;
    }
    setFormError(null);
    const saved = await send(
      {
        action: "repeat-save",
        id: draft.recurring ? draft.id : null,
        name: draft.name.trim(),
        weekdays,
        slots,
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
  const programIds = new Set(board.programs.map((program) => program.id));
  const looseClocks = listed.filter((clock) => !clock.programId || !programIds.has(clock.programId));

  const period = view === "hours" ? prettyDay(cursor || israelDate()) : title;
  const views = [
    { key: "month" as const, label: "לוח", onClick: () => setView("month") },
    { key: "list" as const, label: "רשימה", onClick: () => setView("list") },
    { key: "hours" as const, label: "24 שעות", onClick: showHours },
  ];

  return (
    <section className="min-w-0 space-y-3 sm:space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[22px] leading-7 font-normal sm:text-[28px] sm:leading-[34px]">תוכניות</h2>
        <Button type="button" className="h-11 shrink-0 rounded-xl px-3 sm:px-4" onClick={() => beginProgram()} disabled={Boolean(selecting)}>
          תוכנית חדשה
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center rounded-[14px] bg-secondary p-1" role="group" aria-label="הזזת התאריך">
          <button
            type="button"
            className="h-11 shrink-0 rounded-[10px] bg-card px-3 text-[15px] sm:px-4"
            onClick={() => (view === "hours" ? shiftDay(-1) : shiftMonth(-1))}
          >
            הקודם
          </button>
          <p className="min-w-0 flex-1 truncate px-2 text-center text-[15px] font-semibold sm:px-3 sm:text-[17px]">{period}</p>
          <button
            type="button"
            className="h-11 shrink-0 rounded-[10px] bg-card px-3 text-[15px] sm:px-4"
            onClick={() => (view === "hours" ? shiftDay(1) : shiftMonth(1))}
          >
            הבא
          </button>
        </div>
        <div className="grid min-w-0 grid-flow-col rounded-[14px] bg-secondary p-1" role="tablist" aria-label="תצוגת הלוח">
          {views.map((item) => {
            const selected = view === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn(
                  "h-11 min-w-0 rounded-[10px] px-2 text-[14px] sm:px-4 sm:text-[15px]",
                  selected ? "bg-card font-semibold text-primary" : "text-foreground",
                )}
                onClick={item.onClick}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <label className="flex min-w-0 items-center gap-2 text-[15px]">
          עיר
          <select
            className={cn(fieldClass, "h-11 w-auto max-w-[12rem] rounded-xl bg-card px-3")}
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
        </label>
        {tenants ? (
          <Button type="button" variant="ghost" className="h-11 rounded-xl px-3" onClick={() => setBoard(null)}>
            לקוח אחר
          </Button>
        ) : null}
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground sm:text-sm">
        <span className="sm:hidden">+ מוסיף שעון ליום. נרות והבדלה לידיעה.</span>
        <span className="hidden sm:inline">
          לחצו + כדי להוסיף שעון ליום, ואפשר לבחור כמה שקעים. בחזרה אפשר כל יום, או ימים בשבוע, ולשמור את זה כתוכנית. בתצוגת 24 שעות רואים בכל שקע מתי הוא דולק. נרות והבדלה מוצגים לידיעה.
        </span>
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

      {view === "hours" ? (
        <HourBoard board={board} day={cursor || israelDate()} onOpenClock={openClock} onOpenProgram={openRepeat} />
      ) : view === "month" ? (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-border bg-border">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="truncate bg-muted px-0.5 py-1 text-center text-[10px] font-medium sm:px-1 sm:py-1.5 sm:text-xs">
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
                  "flex min-h-0 flex-col gap-px overflow-hidden bg-card p-0.5 text-[10px] leading-[1.15] sm:min-h-32 sm:gap-0.5 sm:p-1.5 sm:text-[11px] sm:leading-tight",
                  !day.inMonth && "bg-muted/50 text-muted-foreground",
                  program && TINTS[programIndex % TINTS.length],
                  chosen && "ring-2 ring-primary ring-inset",
                  selecting && "cursor-pointer",
                )}
                onClick={() => {
                  if (selecting) toggleDay(day.date);
                }}
              >
                <div className="flex items-center justify-between gap-0.5">
                  <span className="font-semibold tabular-nums">{day.day}</span>
                  <button
                    type="button"
                    aria-label={`הוספת שעון ב-${day.date}`}
                    className="size-5 shrink-0 rounded-full border border-border bg-background text-[12px] leading-none hover:bg-muted sm:size-8 sm:text-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      openNew(day);
                    }}
                  >
                    +
                  </button>
                </div>
                {clocks.map((clock) => {
                  const owner = board.programs.find((item) => item.id === clock.programId);
                  const paused = Boolean(owner && !owner.enabled);
                  return (
                    <button
                      key={clock.id}
                      type="button"
                      className={cn(
                        "block w-full truncate rounded bg-background/80 px-0.5 py-px text-start hover:bg-background sm:px-1 sm:py-0.5",
                        paused && "opacity-50 line-through",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        openClock(clock);
                      }}
                    >
                      <ClockFace clock={clock} compact />
                    </button>
                  );
                })}
                <p className="hidden truncate text-muted-foreground sm:block">{day.hebrew}</p>
                {day.parsha ? <p className="truncate font-semibold text-primary">{day.parsha}</p> : null}
                {day.holiday ? <p className="truncate">{day.holiday}</p> : null}
                {day.candles ? (
                  <p className="truncate text-muted-foreground" title={`נרות ${day.candles}`}>
                    <span className="sm:hidden" dir="ltr">{day.candles}</span>
                    <span className="hidden sm:inline">נרות <span dir="ltr">{day.candles}</span></span>
                  </p>
                ) : null}
                {day.havdalah ? (
                  <p className="truncate text-muted-foreground" title={`הבדלה ${day.havdalah}`}>
                    <span className="sm:hidden" dir="ltr">{day.havdalah}</span>
                    <span className="hidden sm:inline">הבדלה <span dir="ltr">{day.havdalah}</span></span>
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {board.programs.length || looseClocks.length ? (
            <ul>
              {board.programs.map((program) => (
                <li key={program.id} className="grid gap-3 border-b border-border px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-medium">{program.name}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {program.enabled ? "פועלת" : "כבויה"}
                      {" · "}
                      {program.weekdays.length ? (
                        <>
                          {weekdayPhrase(program.weekdays)}
                          <SlotsLine slots={program.slots} />
                        </>
                      ) : (
                        program.days.map(prettyDay).join(" · ") || "אין ימים"
                      )}
                      {program.deviceIds.length ? ` · ${deviceNames(board, program.deviceIds)}` : ""}
                    </p>
                  </div>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl px-4"
                      disabled={pending === program.id}
                      onClick={() => void send({ action: "program-toggle", id: program.id }, program.id)}
                    >
                      {program.enabled ? "כיבוי" : "הפעלה"}
                    </Button>
                    <Button type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={() => beginProgram(program)}>
                      עריכה
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 rounded-xl px-3 text-destructive"
                      onClick={() => {
                        if (window.confirm("למחוק את התוכנית ואת השעונים שלה?")) {
                          void send({ action: "program-delete", id: program.id }, program.id);
                        }
                      }}
                    >
                      מחיקה
                    </Button>
                  </span>
                </li>
              ))}
              {looseClocks.map((clock) => (
                <li key={clock.id} className="grid gap-3 border-b border-border px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-medium">{prettyDay(clock.day)}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {clock.hebrew} · <ClockFace clock={clock} /> · {deviceNames(board, clock.deviceIds)} · בלי תוכנית
                    </p>
                  </div>
                  <span className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={() => openClock(clock)}>
                      עריכה
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 rounded-xl px-3 text-destructive"
                      onClick={() => {
                        if (window.confirm("למחוק את השעון?")) void send({ action: "clock-delete", id: clock.id }, clock.id);
                      }}
                    >
                      מחיקה
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">אין עדיין שעונים. בלוח, לחצו + על היום.</p>
          )}
        </div>
      )}

      {view === "list" ? null : <div className="space-y-3">
        <h3 className="text-[17px] font-semibold">התוכניות השמורות</h3>
        {board.programs.length ? (
          <div className="grid gap-px overflow-hidden rounded-[22px] bg-border">
            {board.programs.map((program) => (
              <article key={program.id} className="bg-card px-4 py-3">
                <div className="min-w-0">
                  <h4 className="font-medium">{program.name}</h4>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {program.enabled ? "פועלת" : "כבויה"}
                    {" · "}
                    {program.weekdays.length ? (
                      <>
                        {weekdayPhrase(program.weekdays)}
                        <SlotsLine slots={program.slots} />
                      </>
                    ) : (
                      program.days.map(prettyDay).join(" · ") || "אין ימים"
                    )}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl px-4"
                    disabled={pending === program.id}
                    onClick={() => void send({ action: "program-toggle", id: program.id }, program.id)}
                  >
                    {program.enabled ? "כיבוי" : "הפעלה"}
                  </Button>
                  <Button type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={() => beginProgram(program)}>
                    עריכה
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 rounded-xl px-3 text-destructive"
                    onClick={() => {
                      if (window.confirm("למחוק את התוכנית ואת השעונים שלה?")) {
                        void send({ action: "program-delete", id: program.id }, program.id);
                      }
                    }}
                  >
                    מחיקה
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">אין תוכניות. תוכנית היא כמה ימים בלוח, או חזרה לפי ימים בשבוע.</p>
        )}
      </div>}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setFormError(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          {draft ? (
            <form
              className="contents"
              onSubmit={(event) => {
                event.preventDefault();
                void saveClock();
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {draft.repeat === "once"
                    ? draft.id && !draft.recurring
                      ? "עריכת שעון"
                      : "שעון חדש"
                    : draft.recurring
                      ? "עריכת תוכנית"
                      : "תוכנית חדשה"}
                </DialogTitle>
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
                      size="sm"
                      variant={draft.repeat === value ? "default" : "outline"}
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          repeat: value,
                          weekdays:
                            value === "daily"
                              ? [0, 1, 2, 3, 4, 5, 6]
                              : current.weekdays.length
                                ? current.weekdays
                                : [current.day ? weekdayOf(current.day) : 0],
                        }))
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {draft.repeat === "weekdays" ? (
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAY_CHIPS.map((label, index) => {
                      const selected = draft.weekdays.includes(index);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={selected}
                          aria-label={DAY_NAMES[index]}
                          className={cn(
                            "flex h-11 items-center justify-center rounded-lg border text-sm",
                            selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                          )}
                          onClick={() =>
                            updateDraft((current) => ({
                              ...current,
                              weekdays: current.weekdays.includes(index)
                                ? current.weekdays.filter((day) => day !== index)
                                : [...current.weekdays, index].sort((left, right) => left - right),
                            }))
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {draft.repeat === "weekdays" ? (
                  <p className="text-xs text-muted-foreground">
                    {draft.weekdays.length ? `נבחרו: ${weekdayPhrase(draft.weekdays)}` : "סמנו לפחות יום אחד, ואז לחצו שמירה."}
                  </p>
                ) : null}
                {draft.repeat === "daily" ? (
                  <p className="text-xs text-muted-foreground">כולל שישי ושבת. בלי הימים האלה בחרו ימים בשבוע וסמנו א עד ה.</p>
                ) : null}
              </fieldset>
              {draft.repeat === "once" ? (
                <Label className="flex-col items-stretch gap-1">
                  תאריך
                  <Input dir="ltr" type="date" value={draft.day} onChange={(event) => updateDraft((current) => ({ ...current, day: event.target.value }))} />
                </Label>
              ) : (
                <Label className="flex-col items-stretch gap-1">
                  שם התוכנית
                  <Input
                    value={draft.name}
                    maxLength={40}
                    placeholder="למשל מזגן"
                    onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </Label>
              )}
              <fieldset className="space-y-2">
                {draft.repeat === "once" ? null : (
                  <legend className="text-sm font-medium">
                    שעונים בתוכנית
                    <span className="ms-1 font-normal text-muted-foreground">({draft.slots.length})</span>
                  </legend>
                )}
                <ol className="space-y-2">
                  {(draft.repeat === "once" ? draft.slots.slice(0, 1) : draft.slots).map((slot, index) => (
                    <li
                      key={slot.key}
                      data-slot
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2",
                        draft.repeat !== "once" && "rounded-xl border border-border bg-muted/30 p-2",
                      )}
                    >
                      <Label className="flex-col items-stretch gap-1">
                        הדלקה
                        <Input
                          dir="ltr"
                          type="time"
                          aria-label={`הדלקה, שעון ${index + 1}`}
                          value={slot.onTime}
                          onChange={(event) => editSlot(slot.key, { onTime: event.target.value })}
                        />
                      </Label>
                      <Label className="flex-col items-stretch gap-1">
                        כיבוי
                        <Input
                          dir="ltr"
                          type="time"
                          aria-label={`כיבוי, שעון ${index + 1}`}
                          value={slot.offTime}
                          onChange={(event) => editSlot(slot.key, { offTime: event.target.value })}
                        />
                      </Label>
                      {draft.repeat !== "once" && draft.slots.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mb-0.5 text-muted-foreground"
                          aria-label={`הסרת שעון ${index + 1}`}
                          onClick={() =>
                            updateDraft((current) => ({ ...current, slots: current.slots.filter((item) => item.key !== slot.key) }))
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      ) : (
                        <span className="w-8" />
                      )}
                    </li>
                  ))}
                </ol>
                {draft.repeat !== "once" && draft.slots.length < 12 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-xl border-dashed"
                    onClick={() => updateDraft((current) => ({ ...current, slots: [...current.slots, blankSlot()] }))}
                  >
                    <Plus className="size-4" />
                    עוד שעון
                  </Button>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {draft.repeat === "once"
                    ? "אם הכיבוי מוקדם מההדלקה, הוא יתבצע ביום שלמחרת."
                    : "בכל שעון אפשר רק הדלקה, רק כיבוי או שניהם. כיבוי מוקדם מההדלקה יתבצע למחרת."}
                </p>
              </fieldset>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">שקעים</legend>
                {board.devices.length ? (
                  board.devices.map((device) => (
                    <label key={device.deviceId} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={draft.deviceIds.includes(device.deviceId)}
                        onChange={() =>
                          updateDraft((current) => ({
                            ...current,
                            deviceIds: current.deviceIds.includes(device.deviceId)
                              ? current.deviceIds.filter((id) => id !== device.deviceId)
                              : [...current.deviceIds, device.deviceId],
                          }))
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
                  onChange={(event) => updateDraft((current) => ({ ...current, programId: event.target.value }))}
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
              {formError ? (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                  {formError}
                </p>
              ) : null}
              <DialogFooter className="sticky bottom-0 z-10">
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
                <Button type="submit" disabled={pending === "clock"}>
                  {pending === "clock" ? "שומר…" : "שמירה"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function HourBoard({
  board,
  day,
  onOpenClock,
  onOpenProgram,
}: {
  board: Board;
  day: string;
  onOpenClock: (clock: Clock) => void;
  onOpenProgram: (program: Program) => void;
}) {
  const bars = laneBars(dayBars(day, board.clocks, board.programs));
  const cell = board.month.days.find((item) => item.date === day);
  const now = day === israelDate() ? jerusalemMinutes() : null;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <p className="px-3 py-2 text-sm">
        <span className="font-medium">{DAY_NAMES[weekdayOf(day)]}</span>
        {cell?.hebrew ? <span className="text-muted-foreground"> {cell.hebrew}</span> : null}
        {cell?.parsha ? <span className="font-medium text-primary"> {cell.parsha}</span> : null}
        {cell?.holiday ? <span> · {cell.holiday}</span> : null}
      </p>
      {board.devices.length ? (
        <div dir="ltr">
            <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] sm:grid-cols-[7.5rem_minmax(0,1fr)]">
              <div className="sticky start-0 z-10 border-b border-border bg-card" />
              <div className="relative h-7 border-b border-border">
                {Array.from({ length: 25 }, (_, hour) => (
                  <span key={hour} className="absolute inset-y-0 border-s border-border/60" style={{ left: `${(hour / 24) * 100}%` }}>
                    {hour % 3 === 0 ? (
                      <span
                        className={cn(
                          "absolute top-1 text-[10px] text-muted-foreground",
                          hour === 0 ? "left-1" : hour === 24 ? "right-1" : "-translate-x-1/2",
                        )}
                      >
                        {String(hour).padStart(2, "0")}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
              {board.devices.map((device) => {
                const rows = bars.filter((bar) => bar.deviceId === device.deviceId);
                const lanes = rows.reduce((max, bar) => Math.max(max, bar.lane + 1), 1);
                return (
                  <div key={device.deviceId} className="contents">
                    <div className="sticky start-0 z-10 flex items-center border-b border-border bg-card px-2 py-1 text-sm" dir="rtl">
                      <span>
                        <span className="block leading-tight">{device.name}</span>
                        {rows.map((bar) => (
                          <span key={bar.key} dir="ltr" className="block text-[10px] leading-tight text-muted-foreground">
                            {bar.title.replace(`${bar.name} `, "")}
                          </span>
                        ))}
                      </span>
                    </div>
                    <div
                      className="relative border-b border-border"
                      style={{
                        height: Math.max(44, lanes * 28 + 8),
                        backgroundImage:
                          "repeating-linear-gradient(to right, transparent, transparent calc(100% / 24 - 1px), var(--border) calc(100% / 24 - 1px), var(--border) calc(100% / 24))",
                      }}
                    >
                      {now != null ? (
                        <span className="absolute inset-y-0 z-10 w-0.5 bg-destructive" style={{ left: `${(now / 1440) * 100}%` }} />
                      ) : null}
                      {rows.map((bar) => (
                        <button
                          key={bar.key}
                          type="button"
                          title={bar.title}
                          className={cn(
                            "absolute z-20 overflow-hidden rounded px-1 text-start text-[11px] font-medium text-white",
                            bar.muted && "opacity-40 line-through",
                          )}
                          style={{
                            top: 4 + bar.lane * 28,
                            height: 24,
                            left: `${(bar.start / 1440) * 100}%`,
                            width: `${((bar.end - bar.start) / 1440) * 100}%`,
                            background: barColor(bar.name),
                            minWidth: 6,
                          }}
                          onClick={() => {
                            if (bar.source === "program") {
                              const program = board.programs.find((item) => item.id === bar.sourceId);
                              if (program) onOpenProgram(program);
                              return;
                            }
                            const clock = board.clocks.find((item) => item.id === bar.sourceId);
                            if (clock) onOpenClock(clock);
                          }}
                        >
                          <span className="truncate">{bar.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
        </div>
      ) : (
        <p className="px-3 py-4 text-sm text-muted-foreground">אין שקעים משויכים ללקוח.</p>
      )}
      <p className="px-3 py-2 text-xs text-muted-foreground">כל שורה היא שקע. הפס מראה מתי הוא דולק. פס דהוי הוא תוכנית כבויה.</p>
    </div>
  );
}

function barColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % BAR_COLORS.length;
  return BAR_COLORS[hash];
}

function jerusalemMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function ClockFace({ clock, compact = false }: { clock: Clock; compact?: boolean }) {
  if (compact) {
    const label = clock.onTime && clock.offTime ? `${clock.onTime}–${clock.offTime}` : clock.onTime ?? clock.offTime ?? "";
    return <span dir="ltr">{label}</span>;
  }
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

let slotKey = 0;

function blankSlot(from?: Slot): DraftSlot {
  slotKey += 1;
  return { key: slotKey, onTime: from?.onTime ?? "", offTime: from?.offTime ?? "" };
}

function draftSlots(program: Program): DraftSlot[] {
  const slots = program.slots.length ? program.slots : [{ onTime: program.onTime, offTime: program.offTime }];
  return slots.map((slot) => blankSlot(slot));
}

function SlotsLine({ slots }: { slots: Slot[] }) {
  if (!slots.length) return null;
  return (
    <>
      {slots.map((slot, index) => (
        <span key={index}>
          {" · "}
          {slot.onTime && slot.offTime ? (
            <span dir="ltr" className="inline-block">
              {slot.onTime}–{slot.offTime}
            </span>
          ) : (
            <>
              {slot.onTime ? "הדלקה" : "כיבוי"} <span dir="ltr">{slot.onTime ?? slot.offTime}</span>
            </>
          )}
        </span>
      ))}
    </>
  );
}
