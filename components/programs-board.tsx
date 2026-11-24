"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DayTimeline } from "@/components/day-timeline";
import { DeviceGlyph } from "@/components/device-glyph";
import { PlanDialog, type PlannerClock, type PlannerDraft, type PlannerProgram } from "@/components/plan-dialog";
import { PlanViewDialog } from "@/components/plan-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/client-api";
import type { MonthDay } from "@/lib/hebrew/calendar";
import { formatClockActions } from "@/lib/programs/actions";
import { occurrencesOn, type Occurrence } from "@/lib/programs/occurrences";
import { repeatCaption, weekdayOf } from "@/lib/programs/weekdays";
import { formatIsrael, israelDate, shiftDate } from "@/lib/time";
import type { TenantView } from "@/lib/types";
import { cn } from "cn";

type Clock = PlannerClock & { hebrew: string };
type Program = PlannerProgram & {
  onTime: string | null;
  offTime: string | null;
};

type ShellyBackup = {
  shellyId: string;
  name: string;
  status: "idle" | "pending" | "verified" | "failed";
  mode: "schedule" | "script" | null;
  windowLabel: string | null;
  actionCount: number;
  verifiedAt: string | null;
  error: string | null;
  code: string | null;
  watch: boolean;
  checkedAt: string | null;
  nextCheckAt: string | null;
};

type BoardSchedule = {
  id: string;
  deviceId: string;
  kind: "later_on" | "timer_off";
  day: string;
  time: string;
  label: string;
};

type Board = {
  tenantId: string;
  locationId: string;
  places: Array<{ id: string; name: string }>;
  devices: Array<{ deviceId: string; name: string; icon: string | null }>;
  programs: Program[];
  clocks: Clock[];
  schedules?: BoardSchedule[];
  month: { year: number; month: number; hebrew: string; days: MonthDay[] };
  yomTovDates?: string[];
  shellyBackup?: ShellyBackup[];
};

type Picker = { tenants: TenantView[]; programs: null };
type View = "month" | "list" | "week" | "day";

const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];
const ZMANIM_KEY = "pikud-zmanim-view";

type ZmanimView = {
  shabbat: boolean;
  sunset: boolean;
  tzeit: boolean;
  rabbeinuTam: boolean;
};

const DEFAULT_ZMANIM: ZmanimView = { shabbat: true, sunset: true, tzeit: true, rabbeinuTam: false };

function readZmanim(): ZmanimView {
  try {
    const raw = JSON.parse(localStorage.getItem(ZMANIM_KEY) ?? "") as Partial<ZmanimView>;
    return {
      shabbat: raw.shabbat !== false,
      sunset: raw.sunset !== false,
      tzeit: raw.tzeit !== false,
      rabbeinuTam: raw.rabbeinuTam === true,
    };
  } catch {
    return DEFAULT_ZMANIM;
  }
}

export function ProgramsBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [tenants, setTenants] = useState<TenantView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<View>("month");
  const [zmanim, setZmanim] = useState<ZmanimView>(DEFAULT_ZMANIM);
  const [cursor, setCursor] = useState(() => israelDate());
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<PlannerDraft | null>(null);
  const [inspect, setInspect] = useState<{ program: Program | null; clock: Clock | null } | null>(null);
  const [held, setHeld] = useState<BoardSchedule | null>(null);
  const [backup, setBackup] = useState<ShellyBackup | null>(null);
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

  useEffect(() => {
    const timer = window.setTimeout(() => setZmanim(readZmanim()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function pushBackup(item: ShellyBackup) {
    const payload = await send({ action: "shelly-send", shellyId: item.shellyId }, `shelly:${item.shellyId}`);
    const next = payload?.shellyBackup?.find((row) => row.shellyId === item.shellyId);
    if (next) setBackup(next);
    if (!next) return;
    if (next.status === "failed") toast.error(next.error || "השליחה נכשלה");
    else if (next.status === "verified" && next.actionCount) toast.success("תוכנית היום נשלחה. אפשר לנתק את החשמל לדקה. ההדלקות הקרובות נשארות על השלי.");
    else toast.success("אין פעולות להיום על השלי הזה.");
  }

  async function toggleWatch(item: ShellyBackup) {
    const payload = await send({ action: "shelly-watch", shellyId: item.shellyId, watch: !item.watch }, `watch:${item.shellyId}`);
    const next = payload?.shellyBackup?.find((row) => row.shellyId === item.shellyId);
    if (next) setBackup(next);
  }

  function saveZmanim(next: ZmanimView) {
    setZmanim(next);
    localStorage.setItem(ZMANIM_KEY, JSON.stringify(next));
  }

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

  function cancelClock(clock: Clock) {
    if (!window.confirm("לבטל את התזמון? ההדלקה והכיבוי לא יתבצעו.")) return;
    void send({ action: "clock-delete", id: clock.id }, clock.id).then((payload) => {
      if (!payload) return;
      setInspect(null);
      setDraft(null);
      toast.success("התזמון בוטל");
    });
  }

  const today = israelDate();
  const yomTov = useMemo(() => new Set(board?.yomTovDates ?? []), [board]);
  const nextEvents = useMemo(
    () => (board ? upcoming(board.programs, board.clocks, filter, yomTov, board.schedules ?? []) : []),
    [board, filter, yomTov],
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
      <section className="max-w-xl">
        <h1 className="text-xl font-semibold tracking-tight">תוכניות לפי לקוח</h1>
        <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
          מנהל לא רואה את כל התוכניות של כולם יחד. בוחרים לקוח, ואז רואים ועורכים רק את השעונים והתוכניות שלו.
        </p>
        <div className="mt-3 grid gap-2">
          {tenants.map((tenant) => (
            <button
              key={tenant.id}
              type="button"
              className="rounded-2xl border bg-card px-4 py-3 text-start hover:border-primary/40"
              onClick={() => void load(tenant.id)}
            >
              <span className="block text-[15px] font-semibold">{tenant.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
                {tenant.deviceCount} התקנים · כניסה ללוח התוכניות של הלקוח
              </span>
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
    (sum, day) =>
      sum + (day.inMonth ? occurrencesOn(day.date, board.programs, board.clocks, filter, yomTov, board.schedules ?? []).length : 0),
    0,
  );
  const soon = nextEvents[0];
  const needle = query.trim().toLowerCase();
  const loose = board.clocks.filter(
    (clock) => !clock.recurring && !clock.programId && (filter === "all" || clock.deviceIds.includes(filter)),
  );
  const listedPrograms = shownPrograms.filter((program) => program.name.toLowerCase().includes(needle));
  const listedClocks = loose.filter((clock) => {
    const label = (clock.label || "שעון").toLowerCase();
    return !needle || label.includes(needle) || clock.day.includes(needle);
  });
  const listedSchedules = (board.schedules ?? []).filter((item) => {
    if (filter !== "all" && item.deviceId !== filter) return false;
    return !needle || item.label.toLowerCase().includes(needle) || item.day.includes(needle);
  });
  const pausing = board.programs.find((program) => program.id === pauseId) ?? null;
  const inspecting = inspect
    ? {
        program: inspect.program ? (board.programs.find((item) => item.id === inspect.program?.id) ?? inspect.program) : null,
        clock: inspect.clock,
      }
    : null;

  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-end justify-between gap-3 md:mb-6 md:gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">ניהול אוטומציות</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">תוכניות ותזמונים</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">כל ההפעלות והכיבויים שלך, בלוח אחד מסודר.</p>
        </div>
        <Button type="button" className="h-9 shrink-0 rounded-xl px-3 md:h-10 md:px-4" onClick={() => openNew(today)}>
          ＋ תוכנית חדשה
        </Button>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2 md:mb-6 md:gap-3">
        <div className="rounded-xl border bg-card px-2 py-2 md:rounded-2xl md:px-5 md:py-4">
          <p className="text-[10px] leading-tight text-muted-foreground md:text-xs">תוכניות שמורות</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums md:mt-1 md:text-xl">{savedCount}</p>
        </div>
        <div className="rounded-xl border bg-card px-2 py-2 md:rounded-2xl md:px-5 md:py-4">
          <p className="text-[10px] leading-tight text-muted-foreground md:text-xs">פעולות החודש</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums md:mt-1 md:text-xl">{monthCount}</p>
        </div>
        <div className="rounded-xl border bg-card px-2 py-2 md:rounded-2xl md:px-5 md:py-4">
          <p className="text-[10px] leading-tight text-muted-foreground md:text-xs">הפעולה הקרובה</p>
          <p className="mt-0.5 truncate text-base font-semibold md:mt-1 md:text-xl">{soon ? soon.time : "אין"}</p>
          {soon ? <p className="mt-0.5 hidden text-xs text-muted-foreground md:block">{shortDate(soon.day)}</p> : null}
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <section className="min-w-0 rounded-2xl border bg-card">
          <div className="sticky top-14 z-10 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-2 sm:gap-3 sm:px-5 sm:py-4">
            <div className="flex items-center gap-1">
              <button type="button" className="grid size-9 place-items-center rounded-lg border text-sm" aria-label="הקודם" onClick={() => move(-1)}>
                ‹
              </button>
              <div className="min-w-28 px-2 text-center sm:min-w-48">
                <h2 className="text-sm font-semibold leading-tight">{heading}</h2>
                {view === "month" || view === "list" ? (
                  <p className="mt-0.5 text-[11px] leading-tight whitespace-nowrap text-muted-foreground">{board.month.hebrew}</p>
                ) : null}
              </div>
              <button type="button" className="grid size-9 place-items-center rounded-lg border text-sm" aria-label="הבא" onClick={() => move(1)}>
                ›
              </button>
              <button type="button" className="h-9 rounded-lg border px-3 text-sm" onClick={jumpToday}>
                היום
              </button>
              <ZmanimMenu view={zmanim} onChange={saveZmanim} />
            </div>
            <div className="grid grid-cols-4 rounded-lg bg-secondary p-1" role="tablist" aria-label="תצוגת הלוח">
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
                  className={cn("rounded-md px-2.5 py-1.5 text-xs", view === key ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")}
                  onClick={() => setView(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {view === "month" || view === "week" ? (
            <div className="border-b bg-muted/40 px-1 pt-1 md:px-3 md:pt-3">
              <div className="grid grid-cols-7 gap-1 md:gap-2">
                {WEEKDAYS.map((label) => (
                  <div key={label} className="px-0.5 py-1 text-center text-[11px] font-semibold text-muted-foreground md:px-1 md:py-1.5 md:text-xs">
                    {label}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          </div>
          {view === "list" ? (
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <b>כל התוכניות ({listedPrograms.length + listedClocks.length + listedSchedules.length})</b>
                <input
                  value={query}
                  placeholder="חיפוש תוכנית..."
                  aria-label="חיפוש תוכנית"
                  className="h-10 w-1/2 max-w-48 rounded-xl border px-3"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {listedPrograms.length || listedClocks.length || listedSchedules.length ? (
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
                  {listedSchedules.map((item) => {
                    const device = board.devices.find((entry) => entry.deviceId === item.deviceId);
                    return (
                      <article key={item.id} className="flex items-center gap-3 rounded-xl border p-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
                          <DeviceGlyph name={device?.name ?? item.label} icon={device?.icon} className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <b>{item.kind === "later_on" ? "הדלקה מתוזמנת" : "כיבוי מתוזמן"}</b>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {item.label} · {prettyDay(item.day)} · {item.time}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="rounded-lg border border-destructive/30 px-2 py-1.5 text-xs font-bold text-destructive"
                          onClick={() => setHeld(item)}
                        >
                          ביטול
                        </button>
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
                          <b>{clock.label || "שעון"}</b>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {prettyDay(clock.day)} · {formatClockActions(clock)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <button type="button" className="rounded-lg border px-2 py-1.5 text-xs" onClick={() => showClock(clock)}>
                            פרטים
                          </button>
                          <button type="button" className="rounded-lg border px-2 py-1.5 text-xs" onClick={() => openClock(clock)}>
                            עריכה
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-destructive/30 px-2 py-1.5 text-xs font-bold text-destructive"
                            onClick={() => cancelClock(clock)}
                          >
                            ביטול
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
                  {festivalOf(dayMeta, zmanim.shabbat) ? <FestivalMark name={festivalOf(dayMeta, zmanim.shabbat)!.name} kind={festivalOf(dayMeta, zmanim.shabbat)!.kind} large /> : null}
                  {clockLine(dayMeta, zmanim) ? <p className="mt-0.5 text-[12px] text-muted-foreground">{clockLine(dayMeta, zmanim)}</p> : null}
                  {sunLine(dayMeta, zmanim) ? <p className="mt-0.5 text-[12px] text-muted-foreground">{sunLine(dayMeta, zmanim)}</p> : null}
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
              <DayPoints
                items={(board.schedules ?? []).filter(
                  (item) => item.day === cursor && (filter === "all" || item.deviceId === filter),
                )}
                onOpen={setHeld}
              />
              <DayTimeline
                day={cursor}
                programs={shownPrograms}
                clocks={board.clocks}
                devices={board.devices}
                filter={filter}
                yomTov={yomTov}
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
              <div className="bg-muted/40 p-1 md:p-3">
              <div className="grid grid-cols-7 gap-1 md:gap-2">
                {gridDays.map((day) => {
                  const meta = board.month.days.find((item) => item.date === day);
                  const inMonth = view !== "month" || meta?.inMonth !== false;
                  const events = occurrencesOn(day, board.programs, board.clocks, filter, yomTov, board.schedules ?? []);
                  const cap = view === "month" ? 3 : 6;
                  return (
                    <div
                      key={day}
                      data-date={day}
                      className={cn(
                        "group flex min-w-0 flex-col gap-0.5 rounded-md border bg-card p-0.5 md:gap-1.5 md:rounded-lg md:p-2",
                        view === "month" && "md:min-h-36",
                        view === "week" && "min-h-20 md:min-h-44",
                        !inMonth && !marked(meta) && "bg-muted/50 text-muted-foreground",
                        day === today && !marked(meta) && "bg-primary/5",
                        meta?.yomTov && "border-festival bg-festival-soft",
                        (meta?.cholHaMoed || (meta?.eve && !meta.yomTov)) && "border-chol bg-chol-soft",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-center sm:text-start"
                          onClick={() => {
                            setCursor(day);
                            setView("day");
                          }}
                        >
                          <span className={cn(
                            "mx-auto grid size-5 place-items-center rounded-full text-[11px] font-semibold sm:mx-0 sm:size-6 sm:text-xs",
                            day === today && "bg-primary text-primary-foreground",
                            meta?.yomTov && day !== today && "bg-festival text-festival-ink",
                          )}>
                            {Number(day.slice(8))}
                          </span>
                          {meta?.hebrew ? <HebrewDate value={meta.hebrew} /> : null}
                          {festivalOf(meta, zmanim.shabbat) ? <FestivalMark name={festivalOf(meta, zmanim.shabbat)!.name} kind={festivalOf(meta, zmanim.shabbat)!.kind} /> : null}
                        </button>
                        <button
                          type="button"
                          className="hidden size-5 place-items-center rounded border text-[11px] font-semibold text-muted-foreground opacity-0 transition group-hover:opacity-100 sm:grid"
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
                            "flex w-full min-w-0 items-center justify-center gap-1 rounded border-s-2 px-0.5 py-px text-center text-[10px] leading-[14px] md:justify-start md:gap-1.5 md:rounded-md md:border-s-[3px] md:px-1.5 md:py-1 md:text-start md:text-xs md:leading-4",
                            event.action === "off" ? "border-destructive bg-destructive/10 text-destructive" : "border-online bg-online-soft text-online-foreground",
                          )}
                          title={event.name}
                          onClick={() => openEvent(event, board, showProgram, showClock, setHeld)}
                        >
                          <span dir="ltr">{event.time}</span>
                          <span className="hidden truncate sm:inline">{event.name}</span>
                        </button>
                      ))}
                      {events.length > cap ? (
                        <button
                          type="button"
                          className="px-1 py-0.5 text-start text-[11px] font-semibold text-primary"
                          onClick={() => {
                            setCursor(day);
                            setView("day");
                          }}
                        >
                          +{events.length - cap}
                        </button>
                      ) : null}
                      {clockLine(meta, zmanim, true) ? (
                        <p className="mt-0.5 text-[8px] font-medium leading-3 text-muted-foreground sm:text-[11px] sm:leading-4" title={clockLine(meta, zmanim) ?? undefined}>
                          {clockLine(meta, zmanim, true)}
                        </p>
                      ) : null}
                      <SunFooter meta={meta} view={zmanim} />
                    </div>
                  );
                })}
              </div>
              </div>
              <p className="flex flex-wrap items-center gap-4 px-4 py-3.5 text-[13px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-online" /> הפעלה</span>
                <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-destructive" /> כיבוי</span>
                <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-festival" /> חג</span>
                <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-chol" /> חול המועד וערב חג</span>
                <span>· לחצו על שעון לפתיחת פרטים · על + להוספה</span>
              </p>
            </>
          )}
        </section>
        <aside className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
          <section className="rounded-2xl border bg-card px-5 py-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">ההתקנים שלי</h3>
              <button type="button" className="text-xs font-medium text-primary" onClick={() => setFilter("all")}>
                הכל
              </button>
            </div>
            <div>
              {board.devices.map((device) => {
                const selected = filter === device.deviceId;
                return (
                  <label
                    key={device.deviceId}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 border-b border-border/70 py-3 last:border-0",
                      selected && "bg-primary/5 -mx-2 rounded-xl border-transparent px-2",
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary">
                      <DeviceGlyph name={device.name} icon={device.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm font-medium">{device.name}</b>
                      <small className="mt-0.5 block text-xs text-muted-foreground">{devicePlanCount(board, device.deviceId)} תוכניות</small>
                    </span>
                    <input
                      type="radio"
                      name="device-filter"
                      className="size-4 accent-primary"
                      checked={selected}
                      onChange={() => setFilter(device.deviceId)}
                    />
                  </label>
                );
              })}
            </div>
            {board.shellyBackup?.length ? (
              <div className="mt-1 border-t border-border/70 pt-1">
                {board.shellyBackup.map((item) => (
                  <button
                    key={item.shellyId}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-start text-xs hover:bg-muted"
                    onClick={() => setBackup(item)}
                  >
                    <i
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        item.status === "failed" ? "bg-destructive" : item.status === "verified" ? "bg-online" : "bg-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">גיבוי {item.name}</span>
                    <span className="shrink-0 text-muted-foreground">{backupStatus(item)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
          <section className="rounded-2xl border bg-card px-5 py-5">
            <h3 className="mb-1 text-sm font-semibold">פעולות קרובות</h3>
            {nextEvents.length ? (
              nextEvents.slice(0, 5).map((event) => (
                <button
                  key={`${event.day}-${event.key}`}
                  type="button"
                  className="flex w-full items-center gap-4 border-b border-border/70 py-3 text-start last:border-0"
                  onClick={() => openEvent(event, board, showProgram, showClock, setHeld)}
                >
                  <time className="w-12 shrink-0 text-sm font-semibold tabular-nums" dir="ltr">
                    {event.time}
                  </time>
                  <span className="min-w-0">
                    <b className="block truncate text-sm font-medium">{event.name}</b>
                    <small className="mt-0.5 block text-xs text-muted-foreground">{longDate(event.day)}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="py-3 text-sm text-muted-foreground">אין פעולות קרובות</p>
            )}
          </section>
          <section className="rounded-2xl border bg-card px-5 py-5 sm:col-span-2 lg:col-span-1">
            <h3 className="text-sm font-semibold">זמני שבת</h3>
            <label className="mt-4 block text-xs text-muted-foreground">
              עיר
              <select
                className="mt-1.5 h-10 w-full rounded-xl border bg-card px-3 text-sm text-foreground"
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
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {zmanim.shabbat && zmanim.rabbeinuTam ? "יציאת שבת לפי רבנו תם. " : ""}
              כניסה, יציאה, שקיעה וצאת הכוכבים לפי העיר שנבחרה.
            </p>
            {board.month.days.some((day) => day.sunset) ? (
              <a className="mt-2 inline-block text-xs font-medium text-primary underline" href="https://mevarhim.co.il/" target="_blank" rel="noreferrer">
                זמנים מאתר מברכים
              </a>
            ) : null}
            {tenants ? (
              <button
                type="button"
                className="mt-4 text-sm font-medium text-primary"
                onClick={() => {
                  setBoard(null);
                  setDraft(null);
                }}
              >
                לקוח אחר
              </button>
            ) : null}
          </section>
        </aside>
      </div>
      {backup ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setBackup(null);
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogTitle>גיבוי {backup.name}</DialogTitle>
            <DialogDescription>{backupSummary(backup)}</DialogDescription>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={pending === `shelly:${backup.shellyId}`}
                onClick={() => void pushBackup(backup)}
              >
                {pending === `shelly:${backup.shellyId}` ? "שולח…" : "שליחת תוכנית היום"}
              </button>
              <button
                type="button"
                className="h-9 rounded-lg border px-3 text-sm font-medium disabled:opacity-50"
                aria-pressed={backup.watch}
                disabled={pending === `watch:${backup.shellyId}`}
                onClick={() => void toggleWatch(backup)}
              >
                {backup.watch ? "בדיקה חודשית פעילה" : "הפעלת בדיקה חודשית"}
              </button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              השליחה כותבת לשלי את פעולות היום, גם אם הן בעוד כמה דקות. אחרי הפסקת חשמל הן נשארות על ההתקן ומתבצעות שם. גיבוי השבת חוזר מעצמו אחרי חצות.
              {backup.watch
                ? " הבדיקה החודשית בודקת שההתקן מחובר ושהתוכנית עדיין עליו. אם משהו חסר היא נשלחת שוב, ואם אין קשר היא חוזרת למחרת."
                : ""}
            </p>
            {backup.code ? (
              <pre dir="ltr" className="max-h-[55vh] overflow-auto rounded-xl bg-muted p-3 text-left text-[11px] leading-5 text-foreground">
                {backup.code}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">עדיין לא נשלח קוד להתקן.</p>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
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
                const day = nextOnDay(pausing, board, yomTov);
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
          onCancel={inspecting.clock && !inspecting.program ? () => cancelClock(inspecting.clock!) : undefined}
        />
      ) : null}
      {held ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setHeld(null);
          }}
        >
          <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
            <div className="border-b px-5 pb-4 pt-5 pe-14">
              <DialogTitle className="text-lg font-extrabold leading-7">
                {held.kind === "later_on" ? "הדלקה מתוזמנת" : "כיבוי מתוזמן"}
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-[13px] leading-6">
                {held.label} · {prettyDay(held.day)} · <span dir="ltr">{held.time}</span>
              </DialogDescription>
            </div>
            <p className="px-5 py-4 text-sm leading-6 text-muted-foreground">
              {held.kind === "later_on"
                ? "הביטול מונע את ההדלקה. השקע לא יופעל עכשיו."
                : "הביטול מונע את הכיבוי. מצב השקע נשאר כמו שהוא."}
            </p>
            <div className="flex justify-end gap-2 border-t bg-muted/30 px-4 py-3">
              <button type="button" className="h-10 rounded-xl border bg-card px-3 text-sm font-bold" onClick={() => setHeld(null)}>
                השארה
              </button>
              <button
                type="button"
                className="h-10 rounded-xl bg-destructive px-3 text-sm font-bold text-white"
                disabled={pending === held.id}
                onClick={() => {
                  const id = held.id;
                  void send({ action: "schedule-cancel", id }, id).then((payload) => {
                    if (!payload) return;
                    setHeld(null);
                    toast.success("התזמון בוטל");
                  });
                }}
              >
                ביטול התזמון
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

function openEvent(
  event: Occurrence,
  board: Board,
  showProgram: (program: Program) => void,
  showClock: (clock: Clock) => void,
  showSchedule: (item: BoardSchedule) => void,
) {
  if (event.scheduleId) {
    const schedule = (board.schedules ?? []).find((item) => item.id === event.scheduleId);
    if (schedule) showSchedule(schedule);
    return;
  }
  if (event.programId) {
    const program = board.programs.find((item) => item.id === event.programId);
    if (program) showProgram(program);
    return;
  }
  const clock = board.clocks.find((item) => item.id === event.clockId);
  if (clock) showClock(clock);
}

function DayPoints({ items, onOpen }: { items: BoardSchedule[]; onOpen: (item: BoardSchedule) => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-2 space-y-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-start text-xs"
          onClick={() => onOpen(item)}
        >
          <span dir="ltr" className="font-semibold tabular-nums">
            {item.time}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {item.kind === "later_on" ? "הדלקה" : "כיבוי"} · {item.label}
          </span>
          <span className="font-bold text-destructive">ביטול</span>
        </button>
      ))}
    </div>
  );
}

function upcoming(
  programs: Program[],
  clocks: Clock[],
  filter: string,
  yomTov: ReadonlySet<string>,
  schedules: BoardSchedule[] = [],
) {
  const today = israelDate();
  const clock = jerusalemTime();
  const rows: Array<Occurrence & { day: string }> = [];
  for (let index = 0; index < 60 && rows.length < 5; index += 1) {
    const day = shiftDate(today, index);
    for (const event of occurrencesOn(day, programs, clocks, filter, yomTov, schedules)) {
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

function backupStatus(item: ShellyBackup) {
  if (item.status === "failed") return "נכשל";
  if (item.status === "pending") return "נשלח";
  if (item.status === "verified") return item.actionCount ? "נשמר" : "ריק";
  return "ממתין";
}

function backupSummary(item: ShellyBackup) {
  const detail =
    item.status === "verified"
      ? item.actionCount
        ? "הקוד הזה נשמר ואומת בהתקן."
        : "אין פעולות לשבת ולחג הקרובים."
      : item.status === "failed"
        ? "הסנכרון לא הושלם. המערכת תנסה שוב."
        : item.status === "pending"
          ? "הקוד בדרך להתקן."
          : "הקוד יישלח להתקן לפני הכניסה.";
  return [item.windowLabel, detail, item.verifiedAt ? `סנכרון אחרון ${formatIsrael(item.verifiedAt)}` : null, item.checkedAt ? `בדיקה אחרונה ${formatIsrael(item.checkedAt)}` : null, item.watch && item.nextCheckAt ? `בדיקה הבאה ${formatIsrael(item.nextCheckAt)}` : null, item.error]
    .filter(Boolean)
    .join(" ");
}

function marked(meta: MonthDay | undefined) {
  return Boolean(meta?.yomTov || meta?.cholHaMoed || meta?.eve);
}

function festivalOf(meta: MonthDay | undefined, showTimes: boolean): { name: string; kind: "yom-tov" | "chol" | "eve" } | null {
  if (!meta) return null;
  if (meta.yomTov) return { name: meta.yomTov, kind: "yom-tov" };
  if (meta.cholHaMoed) return { name: meta.cholHaMoed, kind: "chol" };
  if (meta.eve) return { name: showTimes && meta.candles ? `ערב ${meta.eve} ${meta.candles}` : `ערב ${meta.eve}`, kind: "eve" };
  return null;
}

function sunLine(meta: MonthDay | undefined, view: ZmanimView) {
  if (!meta) return null;
  return [view.sunset && meta.sunset ? `שקיעה ${meta.sunset}` : null, view.tzeit && meta.tzeit ? `צאת הכוכבים ${meta.tzeit}` : null]
    .filter(Boolean)
    .join(" · ");
}

function SunFooter({ meta, view }: { meta: MonthDay | undefined; view: ZmanimView }) {
  const sunset = view.sunset ? meta?.sunset : null;
  const tzeit = view.tzeit ? meta?.tzeit : null;
  if (!meta || (!sunset && !tzeit)) return null;
  return (
    <div className="mt-auto grid gap-px pt-1 text-[8px] leading-3 text-muted-foreground sm:text-[11px] sm:leading-4" title={sunLine(meta, view) || undefined}>
      {sunset ? (
        <p className="flex items-baseline justify-start gap-1 whitespace-nowrap">
          <span>ש׳</span>
          <span dir="ltr" className="tabular-nums">{sunset}</span>
        </p>
      ) : null}
      {tzeit ? (
        <p className="flex items-baseline justify-start gap-1 whitespace-nowrap">
          <span>צה״כ</span>
          <span dir="ltr" className="tabular-nums">{tzeit}</span>
        </p>
      ) : null}
    </div>
  );
}

function shabbatExit(meta: MonthDay, view: ZmanimView) {
  const tam = view.rabbeinuTam && meta.weekday === 6 ? meta.rabbeinuTam : null;
  const time = tam ?? meta.havdalah;
  if (!time) return null;
  if (meta.weekday === 6) return tam ? `יציאת שבת ר״ת ${time}` : `יציאת שבת ${time}`;
  if (meta.yomTov) return `יציאת החג ${time}`;
  return `יציאה ${time}`;
}

function clockLine(meta: MonthDay | undefined, view: ZmanimView, compact = false) {
  if (!meta) return null;
  const showParsha = view.shabbat || view.sunset || view.tzeit;
  const parts = [
    showParsha && meta.parsha ? (compact ? meta.parsha : `פרשת ${meta.parsha}`) : null,
    view.shabbat && meta.candles && meta.eve && meta.cholHaMoed ? `כניסת ${meta.eve} ${meta.candles}` : null,
    view.shabbat && meta.candles && !meta.eve && meta.weekday === 5 ? `כניסת שבת ${meta.candles}` : null,
    view.shabbat && meta.candles && !meta.eve && meta.weekday !== 5 ? `כניסה ${meta.candles}` : null,
    view.shabbat ? shabbatExit(meta, view) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function ZmanimMenu({ view, onChange }: { view: ZmanimView; onChange: (next: ZmanimView) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="h-9 rounded-lg border bg-card px-3 text-sm" aria-label="מה להציג בלוח">
        זמנים
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
        <DropdownMenuLabel>מה להציג</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={view.shabbat} onCheckedChange={(checked) => onChange({ ...view, shabbat: checked })}>
          כניסת ויציאת שבת וחג
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={view.sunset} onCheckedChange={(checked) => onChange({ ...view, sunset: checked })}>
          שקיעה
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={view.tzeit} onCheckedChange={(checked) => onChange({ ...view, tzeit: checked })}>
          צאת הכוכבים
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={view.rabbeinuTam}
          disabled={!view.shabbat}
          onCheckedChange={(checked) => onChange({ ...view, rabbeinuTam: checked })}
        >
          יציאת שבת לפי רבנו תם
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onChange({ ...view, shabbat: false, sunset: false, tzeit: false })}>
          הסתר הכל
        </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FestivalMark({ name, kind, large = false }: { name: string; kind: "yom-tov" | "chol" | "eve"; large?: boolean }) {
  return (
    <span
      title={name}
      className={cn(
        "mt-0.5 block rounded px-0.5 py-px text-center font-extrabold sm:px-1 sm:text-start",
        large ? "w-fit px-2 py-1 text-sm leading-5" : "text-[9px] leading-[12px] sm:text-[11px] sm:leading-4",
        kind === "yom-tov" ? "bg-festival text-festival-ink" : "bg-chol text-chol-ink",
      )}
    >
      {name}
    </span>
  );
}

function HebrewDate({ value }: { value: string }) {
  const [day, ...rest] = value.split(" ");
  const month = rest.join(" ");
  return (
    <>
      <span className="mt-0.5 block text-[9px] leading-tight text-muted-foreground sm:hidden">
        {day}
        {month ? <span className="block">{month}</span> : null}
      </span>
      <span className="mt-1 hidden truncate text-[11px] font-medium leading-none text-muted-foreground sm:block">{value}</span>
    </>
  );
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

function nextOnDay(program: Program, board: Board, yomTov: ReadonlySet<string>) {
  const today = israelDate();
  const clock = jerusalemTime();
  const clocks = board.clocks.filter((item) => item.programId === program.id);
  for (let index = 0; index < 84; index += 1) {
    const day = shiftDate(today, index);
    for (const event of occurrencesOn(day, [program], clocks, "all", yomTov)) {
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
