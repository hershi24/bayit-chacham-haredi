"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DeviceGlyph } from "@/components/device-glyph";
import { PlanDialog, type PlannerClock, type PlannerDraft, type PlannerProgram } from "@/components/plan-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client-api";
import type { MonthDay } from "@/lib/hebrew/calendar";
import { occurrencesOn, type Occurrence } from "@/lib/programs/occurrences";
import { weekdayOf, weekdayPhrase } from "@/lib/programs/weekdays";
import { israelDate, shiftDate } from "@/lib/time";
import type { TenantView } from "@/lib/types";
import { cn } from "cn";

type Clock = PlannerClock & { hebrew: string };
type Program = PlannerProgram & {
  onTime: string | null;
  offTime: string | null;
};

type Board = {
  tenantId: string;
  locationId: string;
  places: Array<{ id: string; name: string }>;
  devices: Array<{ deviceId: string; name: string; icon: string | null }>;
  programs: Program[];
  clocks: Clock[];
  month: { year: number; month: number; days: MonthDay[] };
};

type Picker = { tenants: TenantView[]; programs: null };
type View = "month" | "list" | "week" | "day";

const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];

export function ProgramsBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [tenants, setTenants] = useState<TenantView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => israelDate());
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<PlannerDraft | null>(null);
  const [pauseId, setPauseId] = useState<string | null>(null);
  const [pauseDate, setPauseDate] = useState("");
  const [token, setToken] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string | null, year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (year) params.set("year", String(year));
    if (month) params.set("month", String(month));
    const queryString = params.toString();
    try {
      const payload = await api<Board | Picker>(`/api/programs${queryString ? `?${queryString}` : ""}`);
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

  async function send(body: Record<string, unknown>, key: string) {
    if (!board) return null;
    setPending(key);
    setFormError(null);
    try {
      const payload = await api<Board>("/api/programs", {
        method: "POST",
        body: JSON.stringify({ ...body, tenantId: board.tenantId, year: board.month.year, month: board.month.month }),
      });
      setBoard(payload);
      setError(null);
      return payload;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "השמירה נכשלה";
      setFormError(message);
      toast.error(message);
      return null;
    } finally {
      setPending(null);
    }
  }

  function ensureMonth(day: string) {
    if (!board) return;
    const [year, month] = day.split("-").map(Number);
    if (year !== board.month.year || month !== board.month.month) void load(board.tenantId, year, month);
  }

  function move(delta: number) {
    if (!board) return;
    if (view === "month" || view === "list") {
      const next = new Date(Date.UTC(board.month.year, board.month.month - 1 + delta, 1));
      setCursor(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`);
      void load(board.tenantId, next.getUTCFullYear(), next.getUTCMonth() + 1);
      return;
    }
    const next = shiftDate(cursor, delta * (view === "week" ? 7 : 1));
    setCursor(next);
    ensureMonth(next);
  }

  function jumpToday() {
    const day = israelDate();
    setCursor(day);
    ensureMonth(day);
  }

  function openDraft(partial: Pick<PlannerDraft, "mode" | "date" | "program" | "clock">) {
    if (!board) return;
    const next = token + 1;
    setToken(next);
    setFormError(null);
    setDraft({
      ...partial,
      token: next,
      clocks: board.clocks,
      devices: board.devices,
      places: board.places,
      locationId: board.locationId,
    });
  }

  function openNew(date: string) {
    openDraft({ mode: "new", date, program: null, clock: null });
  }

  function openProgram(program: Program, day: string | null) {
    openDraft({
      mode: "program",
      date: day || program.days[0] || program.startDate || israelDate(),
      program,
      clock: null,
    });
  }

  function openClock(clock: Clock) {
    const program = clock.programId ? board?.programs.find((item) => item.id === clock.programId) : undefined;
    if (program) {
      openProgram(program, clock.day);
      return;
    }
    openDraft({ mode: "clock", date: clock.day, program: null, clock });
  }

  const today = israelDate();
  const nextEvents = useMemo(
    () => (board ? upcoming(board.programs, board.clocks, filter) : []),
    [board, filter],
  );

  if (error && !board) {
    return (
      <section className="rounded-2xl border bg-card p-6">
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
        <h1 className="text-2xl font-semibold tracking-tight">תוכניות ותזמונים</h1>
        <p className="mt-1 text-sm text-muted-foreground">בחרו לקוח כדי לערוך את התוכניות שלו.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {tenants.map((tenant) => (
            <button
              key={tenant.id}
              type="button"
              className="rounded-2xl border bg-card px-4 py-3 text-start hover:bg-muted"
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

  const monthTitle = new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(Date.UTC(board.month.year, board.month.month - 1, 15)));
  const heading = view === "day" ? longDay(cursor) : view === "week" ? weekLabel(cursor) : monthTitle;
  const gridDays = view === "week" ? weekDays(cursor) : view === "day" ? [cursor] : board.month.days.map((day) => day.date);
  const shownPrograms = board.programs.filter((program) => filter === "all" || program.deviceIds.includes(filter));
  const savedCount = shownPrograms.filter((program) => program.enabled).length;
  const monthCount = board.month.days.reduce(
    (sum, day) => sum + (day.inMonth ? occurrencesOn(day.date, board.programs, board.clocks, filter).length : 0),
    0,
  );
  const soon = nextEvents[0];
  const needle = query.trim().toLowerCase();
  const loose = board.clocks.filter(
    (clock) => !clock.recurring && !clock.programId && (filter === "all" || clock.deviceIds.includes(filter)),
  );
  const listedPrograms = shownPrograms.filter((program) => program.name.toLowerCase().includes(needle));
  const listedClocks = loose.filter((clock) => "שעון".includes(needle) || clock.day.includes(needle));
  const pausing = board.programs.find((program) => program.id === pauseId) ?? null;

  return (
    <section className="min-w-0">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-primary">ניהול אוטומציות</p>
          <h1 className="text-[23px] font-semibold tracking-tight sm:text-[29px]">תוכניות ותזמונים</h1>
          <p className="mt-1 text-sm text-muted-foreground">כל ההפעלות והכיבויים שלך, בלוח אחד מסודר.</p>
        </div>
        <Button type="button" className="h-11 shrink-0 rounded-xl px-3 sm:px-4" onClick={() => openNew(today)}>
          ＋ תוכנית חדשה
        </Button>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-4">
        <Stat label="תוכניות שמורות" value={String(savedCount)} />
        <Stat label="פעולות החודש" value={String(monthCount)} />
        <Stat label="הפעולה הקרובה" value={soon ? `${soon.time} · ${shortDate(soon.day)}` : "אין"} small />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-3 sm:px-4">
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-lg border px-3 py-2" aria-label="הקודם" onClick={() => move(-1)}>
                ‹
              </button>
              <h2 className="min-w-28 px-1 text-center text-sm font-semibold sm:min-w-40 sm:text-base">{heading}</h2>
              <button type="button" className="rounded-lg border px-3 py-2" aria-label="הבא" onClick={() => move(1)}>
                ›
              </button>
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={jumpToday}>
                היום
              </button>
            </div>
            <div className="grid grid-cols-4 rounded-xl bg-secondary p-1" role="tablist" aria-label="תצוגת הלוח">
              {(
                [
                  ["month", "חודש"],
                  ["list", "רשימה"],
                  ["week", "שבוע"],
                  ["day", "יום"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  className={cn("rounded-lg px-2 py-1.5 text-xs sm:text-sm", view === key ? "bg-card font-semibold text-primary shadow-sm" : "text-muted-foreground")}
                  onClick={() => setView(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {view === "list" ? (
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <b>כל התוכניות ({listedPrograms.length + listedClocks.length})</b>
                <input
                  value={query}
                  placeholder="חיפוש תוכנית..."
                  aria-label="חיפוש תוכנית"
                  className="h-10 w-1/2 max-w-48 rounded-xl border px-3"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {listedPrograms.length || listedClocks.length ? (
                <div className="space-y-2">
                  {listedPrograms.map((program) => {
                    const device = board.devices.find((item) => program.deviceIds.includes(item.deviceId));
                    return (
                      <article key={program.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
                          <DeviceGlyph name={device?.name ?? program.name} icon={device?.icon} className="size-5" />
                        </span>
                        <div className={cn("min-w-0 flex-1", !program.enabled && "opacity-60")}>
                          <b className="block truncate">{program.name}</b>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {deviceNames(board, program.deviceIds)} · {whenLabel(program)}
                            {program.endDate && (program.weekdays.length || program.days.length > 1) ? ` · עד ${prettyDay(program.endDate)}` : ""}
                            {!program.enabled ? " · כבויה" : ""}
                            {(program.skippedDates ?? []).length
                              ? ` · מושהה ב־${(program.skippedDates ?? []).map((day) => prettyDay(day)).join(", ")}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className={cn(
                              "rounded-lg px-2 py-1.5 text-xs font-bold",
                              program.enabled ? "bg-destructive/10 text-destructive" : "bg-online-soft text-online-foreground",
                            )}
                            disabled={pending === program.id}
                            aria-label={program.enabled ? "כיבוי התוכנית" : "הדלקת התוכנית"}
                            onClick={() => void send({ action: "program-toggle", id: program.id }, program.id)}
                          >
                            {program.enabled ? "כיבוי" : "הדלקה"}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border px-2 py-1.5 text-xs font-bold"
                            onClick={() => {
                              setPauseDate("");
                              setPauseId(program.id);
                            }}
                          >
                            השהיה{(program.skippedDates ?? []).length ? ` (${program.skippedDates.length})` : ""}
                          </button>
                          <button type="button" className="rounded-lg border px-2 py-1.5 text-xs" onClick={() => openProgram(program, null)}>
                            עריכה
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {listedClocks.map((clock) => {
                    const device = board.devices.find((item) => clock.deviceIds.includes(item.deviceId));
                    return (
                      <article key={clock.id} className="flex items-center gap-3 rounded-xl border p-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
                          <DeviceGlyph name={device?.name ?? "שקע"} icon={device?.icon} className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <b>שעון</b>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {deviceNames(board, clock.deviceIds)} · {prettyDay(clock.day)} · {clock.onTime ?? ""}{clock.offTime ? `–${clock.offTime}` : ""}
                          </p>
                        </div>
                        <button type="button" className="rounded-lg border px-2 py-1.5 text-xs" onClick={() => openClock(clock)}>
                          עריכה
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">אין תוכניות להצגה. לחצו על «תוכנית חדשה» כדי להתחיל.</p>
              )}
            </div>
          ) : (
            <>
              {view === "day" ? null : (
                <div className={cn("grid gap-px bg-border", view === "week" ? "grid-cols-7" : "grid-cols-7")}>
                  {WEEKDAYS.map((label) => (
                    <div key={label} className="bg-muted px-1 py-2 text-center text-[11px] font-bold text-muted-foreground sm:text-xs">
                      {label}
                    </div>
                  ))}
                </div>
              )}
              <div className={cn("grid gap-px bg-border", view === "day" ? "grid-cols-1" : "grid-cols-7")}>
                {gridDays.map((day) => {
                  const meta = board.month.days.find((item) => item.date === day);
                  const inMonth = view !== "month" || meta?.inMonth !== false;
                  const events = occurrencesOn(day, board.programs, board.clocks, filter);
                  const cap = view === "month" ? 3 : view === "week" ? 6 : events.length;
                  return (
                    <div
                      key={day}
                      data-date={day}
                      className={cn(
                        "group flex min-w-0 flex-col gap-1 bg-card p-1 sm:p-1.5",
                        view === "month" && "min-h-[5.4rem] sm:min-h-[7.8rem]",
                        view === "week" && "min-h-40",
                        view === "day" && "min-h-56 p-3",
                        !inMonth && "bg-muted/50 text-muted-foreground",
                        day === today && "bg-primary/5",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn("grid size-6 place-items-center rounded-full text-xs font-extrabold", day === today && "bg-primary text-primary-foreground")}>
                          {Number(day.slice(8))}
                        </span>
                        <button
                          type="button"
                          className="grid size-6 place-items-center rounded-lg border text-muted-foreground sm:opacity-20 sm:group-hover:opacity-100"
                          aria-label={`תוכנית חדשה ב-${day}`}
                          onClick={() => openNew(day)}
                        >
                          ＋
                        </button>
                      </div>
                      {events.slice(0, cap).map((event) => (
                        <button
                          key={event.key}
                          type="button"
                          className={cn(
                            "flex w-full min-w-0 items-center gap-1 rounded-md border-s-[3px] px-1 py-1 text-start text-[10px] sm:text-[11px]",
                            event.action === "off" ? "border-destructive bg-destructive/10 text-destructive" : "border-online bg-online-soft text-online-foreground",
                          )}
                          title={event.name}
                          onClick={() => openEvent(event, board, openProgram, openClock)}
                        >
                          <span dir="ltr">{event.time}</span>
                          <span className={cn("truncate", view === "day" ? "inline" : "hidden sm:inline")}>{event.name}</span>
                        </button>
                      ))}
                      {events.length > cap ? (
                        <button
                          type="button"
                          className="px-1 text-start text-[10px] font-bold text-primary"
                          onClick={() => {
                            setCursor(day);
                            setView("day");
                          }}
                        >
                          +{events.length - cap}
                        </button>
                      ) : null}
                      {meta?.parsha ? <p className="hidden truncate text-[10px] font-semibold text-primary sm:block">{meta.parsha}</p> : null}
                      {meta?.candles ? <p className="hidden truncate text-[10px] text-muted-foreground sm:block">נרות {meta.candles}</p> : null}
                      {meta?.havdalah ? <p className="hidden truncate text-[10px] text-muted-foreground sm:block">הבדלה {meta.havdalah}</p> : null}
                    </div>
                  );
                })}
              </div>
              <p className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-online" /> הפעלה</span>
                <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-destructive" /> כיבוי</span>
                <span>· לחצו על + להוספת תוכנית</span>
              </p>
            </>
          )}
        </section>
        <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="mb-3 text-base font-semibold">ההתקנים שלי</h3>
            {board.devices.map((device) => {
              const selected = filter === device.deviceId;
              return (
                <label
                  key={device.deviceId}
                  className={cn("mb-2 flex cursor-pointer items-center gap-2 rounded-xl border p-3", selected && "border-primary/40 bg-primary/5")}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary">
                    <DeviceGlyph name={device.name} icon={device.icon} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{device.name}</b>
                    <small className="text-[11px] text-muted-foreground">{devicePlanCount(board, device.deviceId)} תוכניות</small>
                  </span>
                  <input
                    type="radio"
                    name="device-filter"
                    className="accent-primary"
                    checked={selected}
                    onChange={() => setFilter(device.deviceId)}
                  />
                </label>
              );
            })}
            <button type="button" className="mt-1 h-10 w-full rounded-xl border text-sm" onClick={() => setFilter("all")}>
              הצג את כל ההתקנים
            </button>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="mb-3 text-base font-semibold">פעולות קרובות</h3>
            {nextEvents.length ? (
              nextEvents.slice(0, 5).map((event) => (
                <button
                  key={`${event.day}-${event.key}`}
                  type="button"
                  className="flex w-full items-center gap-3 border-b py-2 text-start last:border-0"
                  onClick={() => openEvent(event, board, openProgram, openClock)}
                >
                  <time className="font-extrabold text-primary" dir="ltr">
                    {event.time}
                  </time>
                  <span className="min-w-0">
                    <b className="block truncate text-sm">{event.name}</b>
                    <small className="text-muted-foreground">{longDate(event.day)}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">אין פעולות קרובות</p>
            )}
          </div>
          <div className="rounded-2xl bg-primary/10 p-4 text-xs leading-6 text-primary sm:col-span-2 lg:col-span-1">
            <b>שליטה חכמה, בדרך שלך</b>
            <br />
            צרו תוכניות חד־פעמיות או חוזרות. התוכנית נשמרת בחשבון ומפעילה את השקעים שנבחרו.
            <label className="mt-3 block font-bold">
              עיר לזמני שבת
              <select
                className="mt-1 h-10 w-full rounded-xl border bg-card px-2 text-foreground"
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
              <button
                type="button"
                className="mt-2 text-sm font-bold"
                onClick={() => {
                  setBoard(null);
                  setDraft(null);
                }}
              >
                לקוח אחר
              </button>
            ) : null}
          </div>
        </aside>
      </div>
      {pausing ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setPauseId(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogTitle>השהיית «{pausing.name}»</DialogTitle>
            <DialogDescription>התוכנית נשארת שמורה. בתאריכים שתבחרו היא לא תופעל, כולל ההפעלה הקרובה.</DialogDescription>
            <button
              type="button"
              className="mt-3 w-full rounded-xl border border-primary/40 bg-primary/5 px-3 py-3 text-sm font-bold text-primary"
              disabled={pending === `skip:${pausing.id}`}
              onClick={() => {
                const day = nextOnDay(pausing, board);
                if (!day) {
                  toast.message("אין הפעלה קרובה להשהיה");
                  return;
                }
                if ((pausing.skippedDates ?? []).includes(day)) {
                  toast.message("ההפעלה הקרובה כבר מושהית");
                  return;
                }
                void writeSkips(pausing, [...(pausing.skippedDates ?? []), day], send);
              }}
            >
              השהה את ההפעלה הקרובה
            </button>
            <div className="mt-3 flex gap-2">
              <label className="min-w-0 flex-1 text-xs font-bold">
                תאריך להשהיה
                <input
                  className="mt-2 h-11 w-full rounded-xl border px-3"
                  dir="ltr"
                  type="date"
                  value={pauseDate}
                  onChange={(event) => setPauseDate(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="mt-6 h-11 shrink-0 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground"
                disabled={pending === `skip:${pausing.id}`}
                onClick={() => {
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(pauseDate)) {
                    toast.error("יש לבחור תאריך");
                    return;
                  }
                  void writeSkips(pausing, [...(pausing.skippedDates ?? []), pauseDate], send);
                }}
              >
                הוספה
              </button>
            </div>
            {(pausing.skippedDates ?? []).length ? (
              <ul className="mt-3 space-y-2">
                {(pausing.skippedDates ?? []).map((day) => (
                  <li key={day} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
                    <span>{prettyDay(day)}</span>
                    <button
                      type="button"
                      className="text-xs font-bold text-destructive"
                      disabled={pending === `skip:${pausing.id}`}
                      onClick={() => void writeSkips(pausing, (pausing.skippedDates ?? []).filter((item) => item !== day), send)}
                    >
                      הסרה
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">אין תאריכים מושהים.</p>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
      {draft ? (
        <PlanDialog
          key={draft.token}
          draft={draft}
          programs={board.programs}
          clocks={board.clocks}
          pending={pending === "plan"}
          serverError={formError}
          onClose={() => setDraft(null)}
          onSave={async (body) => {
            const before = new Set(board.programs.map((item) => item.id));
            const payload = await send(body, "plan");
            if (!payload) return null;
            toast.success("התוכנית נשמרה");
            const id = (typeof body.id === "string" && body.id) || payload.programs.find((item) => !before.has(item.id))?.id || null;
            return { id };
          }}
          onDelete={() => {
            const body =
              draft.mode === "clock" && draft.clock
                ? { action: "clock-delete", id: draft.clock.id }
                : draft.program
                  ? { action: "program-delete", id: draft.program.id }
                  : null;
            if (!body) return;
            void send(body, "plan").then((payload) => {
              if (!payload) return;
              setDraft(null);
              toast.success(draft.mode === "clock" ? "השעון נמחק" : "התוכנית נמחקה");
            });
          }}
        />
      ) : null}
    </section>
  );
}

function Stat({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-3 sm:px-5 sm:py-4">
      <span className="block text-[10px] text-muted-foreground sm:text-xs">{label}</span>
      <strong className={cn("mt-1 block truncate font-semibold", small ? "text-sm sm:text-lg" : "text-xl sm:text-[26px]")}>{value}</strong>
    </div>
  );
}

function openEvent(
  event: Occurrence,
  board: Board,
  openProgram: (program: Program, day: string | null) => void,
  openClock: (clock: Clock) => void,
) {
  if (event.programId) {
    const program = board.programs.find((item) => item.id === event.programId);
    if (program) openProgram(program, event.sourceDay);
    return;
  }
  const clock = board.clocks.find((item) => item.id === event.clockId);
  if (clock) openClock(clock);
}

function upcoming(programs: Program[], clocks: Clock[], filter: string) {
  const today = israelDate();
  const clock = jerusalemTime();
  const rows: Array<Occurrence & { day: string }> = [];
  for (let index = 0; index < 60 && rows.length < 5; index += 1) {
    const day = shiftDate(today, index);
    for (const event of occurrencesOn(day, programs, clocks, filter)) {
      if (index === 0 && event.time <= clock) continue;
      rows.push({ ...event, day });
      if (rows.length >= 5) break;
    }
  }
  return rows;
}

function jerusalemTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function weekDays(cursor: string) {
  const start = shiftDate(cursor, -weekdayOf(cursor));
  return Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
}

function weekLabel(cursor: string) {
  const days = weekDays(cursor);
  return `${prettyDay(days[0])} – ${prettyDay(days[6])}`;
}

function longDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function longDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function shortDate(iso: string) {
  const [, month, day] = iso.split("-");
  return `${Number(day)}.${Number(month)}`;
}

function nextOnDay(program: Program, board: Board) {
  const today = israelDate();
  const clock = jerusalemTime();
  const clocks = board.clocks.filter((item) => item.programId === program.id);
  for (let index = 0; index < 84; index += 1) {
    const day = shiftDate(today, index);
    for (const event of occurrencesOn(day, [program], clocks)) {
      if (event.action !== "on" || event.programId !== program.id) continue;
      if (index === 0 && event.time <= clock) continue;
      return event.sourceDay;
    }
  }
  return null;
}

async function writeSkips(program: Program, dates: string[], send: (body: Record<string, unknown>, key: string) => Promise<Board | null>) {
  const skippedDates = [...new Set(dates.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort();
  const payload = await send({ action: "program-skip", id: program.id, skippedDates }, `skip:${program.id}`);
  if (payload) toast.success(skippedDates.length ? "ההשהיה נשמרה" : "ההשהיה בוטלה");
}

function prettyDay(iso: string) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${Number(day)}.${Number(month)}.${year.slice(2)}`;
}

function whenLabel(program: Program) {
  if (program.weekdays.length === 7) return "כל יום";
  if (program.weekdays.length) return weekdayPhrase(program.weekdays);
  if (program.days.length === 1) return prettyDay(program.days[0]);
  if (program.days.length) return `${program.days.length} תאריכים`;
  return "בלי ימים";
}

function deviceNames(board: Board, ids: string[]) {
  return ids.map((id) => board.devices.find((device) => device.deviceId === id)?.name ?? id).join(", ");
}

function devicePlanCount(board: Board, deviceId: string) {
  const programs = board.programs.filter((program) => program.deviceIds.includes(deviceId)).length;
  const loose = board.clocks.filter((clock) => !clock.recurring && !clock.programId && clock.deviceIds.includes(deviceId)).length;
  return programs + loose;
}
