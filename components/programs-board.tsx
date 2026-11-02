"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client-api";
import type { ClockSettings, ProgramWindow } from "@/lib/hebrew/calendar";
import type { TenantView } from "@/lib/types";

type Card = {
  id: string | null;
  key: string;
  name: string;
  blurb: string;
  enabled: boolean;
  custom: boolean;
  deviceIds: string[];
  startDate: string | null;
  endDate: string | null;
  windows: ProgramWindow[];
};

type AgendaItem = ProgramWindow & { programKey: string; programName: string };

type Board = {
  tenantId: string;
  settings: ClockSettings;
  places: Array<{ id: string; name: string }>;
  devices: Array<{ deviceId: string; name: string }>;
  programs: Card[];
  agenda: AgendaItem[];
  parshiot: ProgramWindow[];
};

type Picker = { tenants: TenantView[]; programs: null };

const fieldClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ProgramsBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [tenants, setTenants] = useState<TenantView[] | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [clock, setClock] = useState<ClockSettings | null>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const load = useCallback(async (nextTenant: string | null) => {
    try {
      const payload = await api<Board | Picker>(nextTenant ? `/api/programs?tenantId=${encodeURIComponent(nextTenant)}` : "/api/programs");
      if (!payload.programs) {
        setTenants(payload.tenants);
        setBoard(null);
        return;
      }
      setBoard(payload);
      setClock(payload.settings);
      setTenantId(payload.tenantId);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת התוכניות נכשלה");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send(body: Record<string, unknown>, key: string) {
    if (!board) return false;
    setPending(key);
    try {
      const payload = await api<Board>("/api/programs", {
        method: "POST",
        body: JSON.stringify({ ...body, tenantId: board.tenantId }),
      });
      setBoard(payload);
      setClock(payload.settings);
      setError(null);
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "השמירה נכשלה");
      return false;
    } finally {
      setPending(null);
    }
  }

  if (error && !board) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-destructive">{error}</p>
        <Button className="mt-4" type="button" onClick={() => void load(tenantId)}>
          נסו שוב
        </Button>
      </section>
    );
  }

  if (!board && tenants) {
    return (
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">תוכניות</h2>
        <p className="mt-1 text-sm text-muted-foreground">בחרו לקוח כדי לערוך את השעון ואת התוכניות שלו.</p>
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

  if (!board || !clock) {
    return (
      <section>
        <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="mt-4 h-36 animate-pulse rounded-2xl bg-muted" />
      </section>
    );
  }

  const next = board.parshiot[0];

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">תוכניות</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          שעון שבת אחד, ואחר כך תוכניות לחגים. ראש השנה הוא יומיים: הפעלה אחת מדליקה את כל היומיים. בטלפון, אחרי בחירת השקע, הקש חמש.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {board.parshiot.slice(0, 3).map((item, index) => (
          <article key={item.start} className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <p className="text-xs text-muted-foreground">{index === 0 ? "השבת הקרובה" : index === 1 ? "בשבוע שאחריה" : "ואחריה"}</p>
            <h3 className="mt-1 text-lg font-semibold">{item.parsha}</h3>
            <p className="text-sm text-muted-foreground">{item.hebrew}</p>
            <p className="mt-2 text-sm">
              כניסה {clockOf(item.start)} · יציאה {clockOf(item.end)}
            </p>
          </article>
        ))}
      </div>

      <form
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void send(
            {
              action: "settings",
              locationId: clock.locationId,
              startAction: clock.startAction,
              startOffsetMin: clock.startOffsetMin,
              endAction: clock.endAction,
              endOffsetMin: clock.endOffsetMin,
            },
            "settings",
          );
        }}
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-medium">שעון שבת</h3>
            <p className="text-sm text-muted-foreground">הזמנים לפי העיר. אפשר להקדים או לאחר בדקות, והתוכניות נבנות מחדש.</p>
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">עיר</span>
            <select className={fieldClass} value={clock.locationId} onChange={(event) => setClock({ ...clock, locationId: event.target.value })}>
              {board.places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ClockRow
            label="בכניסה"
            action={clock.startAction}
            offset={clock.startOffsetMin}
            onAction={(startAction) => setClock({ ...clock, startAction })}
            onOffset={(startOffsetMin) => setClock({ ...clock, startOffsetMin })}
          />
          <ClockRow
            label="ביציאה"
            action={clock.endAction}
            offset={clock.endOffsetMin}
            onAction={(endAction) => setClock({ ...clock, endAction })}
            onOffset={(endOffsetMin) => setClock({ ...clock, endOffsetMin })}
          />
        </div>
        {next ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {next.title}: כניסה {clockOf(next.start)}, יציאה {clockOf(next.end)}
          </p>
        ) : null}
        <Button className="mt-4" type="submit" disabled={pending === "settings"}>
          שמירת השעון
        </Button>
      </form>

      <div className="grid gap-3 lg:grid-cols-2">
        {board.programs.map((program) => {
          const upcoming = program.windows[0];
          const selected = program.deviceIds.length ? program.deviceIds : board.devices.map((device) => device.deviceId);
          return (
            <article key={program.key} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-medium">{program.name}</h3>
                  <p className="text-sm text-muted-foreground">{program.blurb}</p>
                </div>
                <Button
                  type="button"
                  variant={program.enabled ? "default" : "outline"}
                  disabled={pending === program.key}
                  onClick={() => void send({ action: "toggle", key: program.key }, program.key)}
                >
                  {program.enabled ? "פעילה" : "כבויה"}
                </Button>
              </div>
              {upcoming ? (
                <p className="mt-3 text-sm">
                  {upcoming.hebrew}
                  {upcoming.days > 1 ? ` · ${upcoming.days} ימים` : ""}
                  {upcoming.includesShabbat ? " · כולל שבת" : ""}
                  <span className="mt-1 block text-muted-foreground">
                    כניסה {clockOf(upcoming.start)} · יציאה {clockOf(upcoming.end)}
                  </span>
                </p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">אין מועד קרוב</p>
              )}
              {board.devices.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {board.devices.map((device) => {
                    const on = selected.includes(device.deviceId);
                    return (
                      <button
                        key={device.deviceId}
                        type="button"
                        className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}
                        onClick={() => {
                          const next = on ? selected.filter((id) => id !== device.deviceId) : [...selected, device.deviceId];
                          if (!next.length) {
                            toast.message("השאירו לפחות שקע אחד");
                            return;
                          }
                          const deviceIds = next.length === board.devices.length ? [] : next;
                          void send({ action: "devices", key: program.key, deviceIds }, program.key);
                        }}
                      >
                        {device.name}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {program.custom ? (
                <Button className="mt-3" type="button" variant="ghost" onClick={() => void send({ action: "delete", key: program.key }, program.key)}>
                  מחיקה
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="text-lg font-medium">השבועות הקרובים</h3>
        <ul className="mt-3 divide-y divide-border">
          {board.agenda.map((item) => (
            <li key={`${item.programKey}-${item.start}`} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.hebrew}</p>
              </div>
              <p className="text-sm">
                {clockOf(item.start)} עד {clockOf(item.end)}
                <span className="text-muted-foreground"> · {item.programName}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void send({ action: "create", name, startDate, endDate }, "create").then((saved) => {
            if (!saved) return;
            setName("");
            setStartDate("");
            setEndDate("");
          });
        }}
      >
        <h3 className="text-lg font-medium">בניית תוכנית לפי תאריך</h3>
        <p className="text-sm text-muted-foreground">בחרו יום התחלה ויום סיום. השעון רץ מערב היום הראשון עד צאת היום האחרון, עד שבועיים.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">שם</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="למשל שבת חתן" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">מיום</span>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">עד יום</span>
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
          </label>
        </div>
        <Button className="mt-4" type="submit" disabled={pending === "create"}>
          בניית התוכנית
        </Button>
      </form>
    </section>
  );
}

function ClockRow({
  label,
  action,
  offset,
  onAction,
  onOffset,
}: {
  label: string;
  action: "ON" | "OFF";
  offset: number;
  onAction: (action: "ON" | "OFF") => void;
  onOffset: (offset: number) => void;
}) {
  const direction = offset < 0 ? "before" : offset > 0 ? "after" : "exact";
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select className={fieldClass} value={action} onChange={(event) => onAction(event.target.value === "OFF" ? "OFF" : "ON")}>
          <option value="ON">הדלקה</option>
          <option value="OFF">כיבוי</option>
        </select>
        <select
          className={fieldClass}
          value={direction}
          onChange={(event) => {
            const minutes = Math.abs(offset) || 10;
            if (event.target.value === "exact") onOffset(0);
            if (event.target.value === "before") onOffset(-minutes);
            if (event.target.value === "after") onOffset(minutes);
          }}
        >
          <option value="exact">בדיוק בזמן</option>
          <option value="before">לפני</option>
          <option value="after">אחרי</option>
        </select>
        {direction === "exact" ? null : (
          <label className="flex items-center gap-2 text-sm">
            <Input
              className="w-20"
              type="number"
              min={1}
              max={180}
              value={Math.abs(offset)}
              onChange={(event) => {
                const minutes = Math.max(1, Math.min(180, Number(event.target.value) || 1));
                onOffset(direction === "before" ? -minutes : minutes);
              }}
            />
            דקות
          </label>
        )}
      </div>
    </div>
  );
}

function clockOf(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
