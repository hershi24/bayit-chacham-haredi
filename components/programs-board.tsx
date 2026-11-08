"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DayTimeline } from "@/components/day-timeline";
import { DeviceGlyph } from "@/components/device-glyph";
import { PlanDialog, type PlannerClock, type PlannerDraft, type PlannerProgram } from "@/components/plan-dialog";
import { PlanViewDialog } from "@/components/plan-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client-api";
import type { MonthDay } from "@/lib/hebrew/calendar";
import { occurrencesOn, type Occurrence } from "@/lib/programs/occurrences";
import { repeatCaption, weekdayOf } from "@/lib/programs/weekdays";
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
  const [inspect, setInspect] = useState<{ program: Program | null; clock: Clock | null } | null>(null);
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

  function showProgram(program: Program) {
    setInspect({ program, clock: null });
  }

  function showClock(clock: Clock) {
    const program = clock.programId ? board?.programs.find((item) => item.id === clock.programId) : undefined;
    setInspect(program ? { program, clock: null } : { program: null, clock });
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
  const dayMeta = board.month.days.find((item) => item.date === cursor);
  const heading =
    view === "day"
      ? `${longDay(cursor)}${dayMeta?.hebrew ? ` · ${dayMeta.hebrew}` : ""}`
      : view === "week"
        ? weekLabel(cursor)
        : monthTitle;
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
  const inspecting = inspect
    ? {
        program: inspect.program ? (board.programs.find((item) => item.id === inspect.program?.id) ?? inspect.program) : null,
        clock: inspect.clock,
      }
    : null;

  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-start justify-between gap-3 md:mb-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">ניהול אוטומציות</p>
          <h1 className="text-[20px] font-semibold tracking-tight md:text-[22px]">תוכניות ותזמונים</h1>
          <p className="mt-0.5 hidden text-[13px] text-muted-foreground sm:block">כל ההפעלות והכיבויים שלך, בלוח אחד מסודר.</p>
        </div>
        <Button type="button" size="sm" className="h-9 shrink-0 rounded-lg px-3 text-[13px]" onClick={() => openNew(today)}>
          ＋ תוכנית חדשה
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-[12px] md:mb-3">
        <span className="text-muted-foreground">
          תוכניות שמורות <strong className="font-semibold text-foreground">{savedCount}</strong>
        </span>
        <span className="hidden text-border sm:inline">·</span>
        <span className="text-muted-foreground">
          פעולות החודש <strong className="font-semibold text-foreground">{monthCount}</strong>
        </span>
        <span className="hidden text-border sm:inline">·</span>
        <span className="min-w-0 truncate text-muted-foreground">
          הפעולה הקרובה{" "}
          <strong className="font-semibold text-foreground">{soon ? `${soon.time} · ${shortDate(soon.day)}` : "אין"}</strong>
        </span>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-4">
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2.5 py-2 sm:px-3">
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-md border px-2 py-1 text-sm" aria-label="הקודם" onClick={() => move(-1)}>
                ‹
              </button>
              <h2 className="min-w-24 px-1 text-center text-[13px] font-semibold sm:min-w-36 sm:text-sm">{heading}</h2>
              <button type="button" className="rounded-md border px-2 py-1 text-sm" aria-label="הבא" onClick={() => move(1)}>
                ›
              </button>
              <button type="button" className="rounded-md border px-2 py-1 text-[12px]" onClick={jumpToday}>
                היום
              </button>
            </div>
            <div className="grid grid-cols-4 rounded-lg bg-secondary p-0.5" role="tablist" aria-label="תצוגת הלוח">
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
                  className={cn("rounded-md px-2 py-1 text-[11px] sm:text-xs", view === key ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")}
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
                    const skipped = program.skippedDates ?? [];
                    return (
                      <article key={program.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
                          <DeviceGlyph name={device?.name ?? program.name} icon={device?.icon} className="size-5" />
                        </span>
                        <div className={cn("min-w-0 flex-1", !program.enabled && "opacity-60")}>
                          <b className="block truncate">{program.name}</b>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {deviceNames(board, program.deviceIds)} · {whenLabel(program)}
                            {!program.enabled ? " · כבויה" : ""}
                            {skipped.length ? ` · מושהה ב־${skipped.map((day) => prettyDay(day)).join(", ")}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-2 text-xs font-bold">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={program.enabled}
                              aria-label={program.enabled ? "כיבוי התוכנית" : "הדלקת התוכנית"}
                              disabled={pending === program.id}
                              className={cn(
                                "relative h-6 w-11 rounded-full transition",
                                program.enabled ? "bg-online" : "bg-border",
                              )}
                              onClick={() => void send({ action: "program-toggle", id: program.id }, program.id)}
                            >
                              <span
                                className={cn(
                                  "absolute top-0.5 size-5 rounded-full bg-white shadow transition",
                                  program.enabled ? "start-5" : "start-0.5",
                                )}
                              />
                            </button>
                          </label>
                          <button
                            type="button"
                            className="rounded-lg border px-2 py-1.5 text-xs font-bold"
                            onClick={() => {
                              setPauseDate("");
                              setPauseId(program.id);
                            }}
                          >
                            השהיה{skipped.length ? ` (${skipped.length})` : ""}
                          </button>
                          <button type="button" className="rounded-lg border px-2 py-1.5 text-xs" onClick={() => showProgram(program)}>
                            פרטים
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
                        <div className="flex flex-wrap gap-1">
                          <button type="button" className="rounded-lg border px-2 py-1.5 text-xs" onClick={() => showClock(clock)}>
                            פרטים
                          </button>
                          <button type="button" className="rounded-lg border px-2 py-1.5 text-xs" onClick={() => openClock(clock)}>
                            עריכה
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">אין תוכניות להצגה. לחצו על «תוכנית חדשה» כדי להתחיל.</p>
              )}
            </div>
          ) : view === "day" ? (
            <div className="p-2.5 sm:p-3">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{shortDayName(cursor)}</p>
                  <h3 className="text-base font-semibold tracking-tight sm:text-lg">
                    {longDay(cursor)}
                    {dayMeta?.hebrew ? <span className="ms-2 text-xs font-medium text-muted-foreground sm:text-sm">{dayMeta.hebrew}</span> : null}
                  </h3>
                  {dayMeta?.parsha || dayMeta?.candles || dayMeta?.havdalah ? (
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {[
                        dayMeta.parsha ? `פרשת ${dayMeta.parsha}` : null,
                        dayMeta.candles ? `כניסת שבת ${dayMeta.candles}` : null,
                        dayMeta.havdalah ? `יציאת שבת ${dayMeta.havdalah}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-lg border text-sm font-semibold text-foreground"
                  aria-label="תוכנית חדשה ליום"
                  onClick={() => openNew(cursor)}
                >
                  ＋
                </button>
              </div>
              <DayTimeline
                day={cursor}
                programs={shownPrograms}
                clocks={board.clocks}
                filter={filter}
                onOpen={(source, id) => {
                  if (source === "program") {
                    const program = board.programs.find((item) => item.id === id);
                    if (program) showProgram(program);
                    return;
                  }
                  const clock = board.clocks.find((item) => item.id === id);
                  if (clock) showClock(clock);
                }}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-px bg-border">
                {WEEKDAYS.map((label) => (
                  <div key={label} className="bg-muted px-1 py-2 text-center text-[11px] font-bold text-muted-foreground sm:text-xs">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-border">
                {gridDays.map((day) => {
                  const meta = board.month.days.find((item) => item.date === day);
                  const inMonth = view !== "month" || meta?.inMonth !== false;
                  const events = occurrencesOn(day, board.programs, board.clocks, filter);
                  const cap = view === "month" ? 3 : 6;
                  return (
                    <div
                      key={day}
                      data-date={day}
                      className={cn(
                        "group flex min-w-0 flex-col gap-0.5 bg-card p-1",
                        view === "month" && "min-h-[4.5rem] md:min-h-[5.25rem]",
                        view === "week" && "min-h-28 md:min-h-32",
                        !inMonth && "bg-muted/50 text-muted-foreground",
                        day === today && "bg-primary/5",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          className="min-w-0 text-start"
                          onClick={() => {
                            setCursor(day);
                            setView("day");
                          }}
                        >
                          <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-semibold", day === today && "bg-primary text-primary-foreground")}>
                            {Number(day.slice(8))}
                          </span>
                          {meta?.hebrew ? (
                            <span className="mt-0.5 block truncate text-[9px] font-medium leading-none text-muted-foreground">
                              {meta.hebrew}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="grid size-5 place-items-center rounded border text-[11px] font-semibold text-muted-foreground opacity-0 transition group-hover:opacity-100"
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
                          onClick={() => openEvent(event, board, showProgram, showClock)}
                        >
                          <span dir="ltr">{event.time}</span>
                          <span className="hidden truncate sm:inline">{event.name}</span>
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
                      {meta?.parsha || meta?.candles || meta?.havdalah ? (
                        <p className="hidden truncate text-[10px] font-semibold text-muted-foreground sm:block">
                          {[
                            meta.parsha ? meta.parsha : null,
                            meta.candles ? `כניסה ${meta.candles}` : null,
                            meta.havdalah ? `יציאה ${meta.havdalah}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-online" /> הפעלה</span>
                <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-destructive" /> כיבוי</span>
                <span>· לחצו על שעון לפתיחת פרטים · על + להוספה</span>
              </p>
            </>
          )}
        </section>
        <aside className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-xl border bg-card p-3">
            <h3 className="mb-2 text-[13px] font-semibold">ההתקנים שלי</h3>
            {board.devices.map((device) => {
              const selected = filter === device.deviceId;
              return (
                <label
                  key={device.deviceId}
                  className={cn("mb-1.5 flex cursor-pointer items-center gap-2 rounded-lg border p-2", selected && "border-primary/40 bg-primary/5")}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary">
                    <DeviceGlyph name={device.name} icon={device.icon} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-medium">{device.name}</b>
                    <small className="text-[10px] text-muted-foreground">{devicePlanCount(board, device.deviceId)} תוכניות</small>
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
            <button type="button" className="mt-1 h-8 w-full rounded-lg border text-[12px]" onClick={() => setFilter("all")}>
              הצג את כל ההתקנים
            </button>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <h3 className="mb-2 text-[13px] font-semibold">פעולות קרובות</h3>
            {nextEvents.length ? (
              nextEvents.slice(0, 5).map((event) => (
                <button
                  key={`${event.day}-${event.key}`}
                  type="button"
                  className="flex w-full items-center gap-2 border-b border-border/60 py-1.5 text-start last:border-0"
                  onClick={() => openEvent(event, board, showProgram, showClock)}
                >
                  <time className="text-[12px] font-semibold text-muted-foreground tabular-nums" dir="ltr">
                    {event.time}
                  </time>
                  <span className="min-w-0">
                    <b className="block truncate text-[12px] font-medium">{event.name}</b>
                    <small className="text-[10px] text-muted-foreground">{longDate(event.day)}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="text-[12px] text-muted-foreground">אין פעולות קרובות</p>
            )}
          </div>
          <div className="rounded-xl bg-muted/60 p-3 text-[11px] leading-5 text-muted-foreground sm:col-span-2 lg:col-span-1">
            <b className="text-foreground">שליטה חכמה, בדרך שלך</b>
            <br />
            צרו תוכניות חד־פעמיות או חוזרות. התוכנית נשמרת בחשבון ומפעילה את השקעים שנבחרו.
            <label className="mt-2 block font-medium text-foreground">
              עיר לזמני שבת
              <select
                className="mt-1 h-8 w-full rounded-lg border bg-card px-2 text-[12px] text-foreground"
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
            <p className="mt-2 text-[11px] leading-5 opacity-90">זמני כניסת ויציאת שבת מחושבים לפי Hebcal לעיר שנבחרה.</p>
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
      {inspecting ? (
        <PlanViewDialog
          program={inspecting.program}
          clock={inspecting.clock}
          clocks={board.clocks}
          devices={board.devices}
          pending={Boolean(pending && inspecting.program && pending === inspecting.program.id)}
          onClose={() => setInspect(null)}
          onEdit={() => {
            const program = inspecting.program;
            const clock = inspecting.clock;
            setInspect(null);
            if (program) openProgram(program, null);
            else if (clock) openClock(clock);
          }}
          onToggle={
            inspecting.program
              ? () => void send({ action: "program-toggle", id: inspecting.program!.id }, inspecting.program!.id)
              : undefined
          }
          onPause={
            inspecting.program
              ? () => {
                  setPauseDate("");
                  setPauseId(inspecting.program!.id);
                  setInspect(null);
                }
              : undefined
          }
        />
      ) : null}
    </section>
  );
}

function openEvent(
  event: Occurrence,
  board: Board,
  showProgram: (program: Program) => void,
  showClock: (clock: Clock) => void,
) {
  if (event.programId) {
    const program = board.programs.find((item) => item.id === event.programId);
    if (program) showProgram(program);
    return;
  }
  const clock = board.clocks.find((item) => item.id === event.clockId);
  if (clock) showClock(clock);
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
  return repeatCaption({
    weekdays: program.weekdays,
    startDate: program.startDate,
    endDate: program.endDate,
    days: program.days,
  });
}

function shortDayName(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("he-IL", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function deviceNames(board: Board, ids: string[]) {
  return ids.map((id) => board.devices.find((device) => device.deviceId === id)?.name ?? id).join(", ");
}

function devicePlanCount(board: Board, deviceId: string) {
  const programs = board.programs.filter((program) => program.deviceIds.includes(deviceId)).length;
  const loose = board.clocks.filter((clock) => !clock.recurring && !clock.programId && clock.deviceIds.includes(deviceId)).length;
  return programs + loose;
}
