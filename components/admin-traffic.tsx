"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/client-api";
import { formatIsrael } from "@/lib/time";

type Side = { requests: number; bytesSent: number; bytesReceived: number };

type Window = {
  elapsedMs: number;
  measured: Side;
  perHour: Side;
  perDay: Side;
  perMonth: Side;
  hourlyIsForecast: boolean;
  dailyIsForecast: boolean;
  monthlyIsForecast: boolean;
};

type Slice = Side & { peer: "supabase" | "wlte"; name: string; operation: "read" | "write" | "delete" | "socket" };

type Snapshot = {
  processStartedAt: string;
  resetAt: string;
  supabase: Window;
  wlte: Window;
  slices: Slice[];
};

const operationLabel: Record<Slice["operation"], string> = {
  read: "קריאה",
  write: "כתיבה",
  delete: "מחיקה",
  socket: "שקע חי",
};

function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function count(value: number) {
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function stamp(value: string) {
  return formatIsrael(value);
}

function PeerCard({ title, window }: { title: string; window: Window }) {
  const rows = [
    ["נמדד מאז האיפוס", window.measured, false],
    ["לשעה", window.perHour, window.hourlyIsForecast],
    ["ליום", window.perDay, window.dailyIsForecast],
    ["לחודש", window.perMonth, window.monthlyIsForecast],
  ] as const;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map(([label, side, forecast]) => (
          <div key={label} className="grid grid-cols-2 gap-2 border-b border-border/70 pb-3 text-sm last:border-0 last:pb-0 sm:grid-cols-4">
            <div className="font-medium">
              {label}
              {forecast ? <span className="ms-2 text-xs text-muted-foreground">תחזית</span> : <span className="ms-2 text-xs text-muted-foreground">נמדד</span>}
            </div>
            <div>{count(side.requests)} בקשות</div>
            <div>יוצא {bytes(side.bytesSent)}</div>
            <div>נכנס {bytes(side.bytesReceived)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AdminTraffic({ active }: { active: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setSnapshot(await api<Snapshot>("/api/admin/traffic"));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת הניטור נכשלה");
    }
  }

  useEffect(() => {
    if (!active) return;
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active]);

  async function reset() {
    setSnapshot(await api<Snapshot>("/api/admin/traffic", { method: "POST" }));
  }

  if (!active) return null;
  if (error) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-destructive">{error}</p>
        <Button className="mt-4" type="button" onClick={() => void load()}>
          נסו שוב
        </Button>
      </div>
    );
  }
  if (!snapshot) return <div className="h-64 animate-pulse rounded-2xl border border-border bg-card" />;

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          המונים נשמרים בזיכרון השרת מאז {stamp(snapshot.processStartedAt)}. האיפוס האחרון היה ב־{stamp(snapshot.resetAt)}. כל עוד לא עברה שעה, יום או חודש, המספר הוא תחזית לפי הקצב שנמדד. הרענון הזה לא קורא לטבלאות.
        </p>
        <Button type="button" variant="outline" onClick={() => void reset()}>
          איפוס מונים
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PeerCard title="Supabase" window={snapshot.supabase} />
        <PeerCard title="WLTE" window={snapshot.wlte} />
      </div>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>לפי טבלה ושירות</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {snapshot.slices.length === 0 ? (
            <p className="text-sm text-muted-foreground">עדיין אין בקשות בחלון הזה.</p>
          ) : (
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-start font-medium">שירות</th>
                  <th className="px-2 py-2 text-start font-medium">יעד</th>
                  <th className="px-2 py-2 text-start font-medium">פעולה</th>
                  <th className="px-2 py-2 text-start font-medium">בקשות</th>
                  <th className="px-2 py-2 text-start font-medium">יוצא</th>
                  <th className="px-2 py-2 text-start font-medium">נכנס</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.slices.map((slice) => (
                  <tr key={`${slice.peer}:${slice.name}:${slice.operation}`} className="border-t border-border/70">
                    <td className="px-2 py-2">{slice.peer === "supabase" ? "Supabase" : "WLTE"}</td>
                    <td className="px-2 py-2">{slice.name}</td>
                    <td className="px-2 py-2">{operationLabel[slice.operation]}</td>
                    <td className="px-2 py-2">{count(slice.requests)}</td>
                    <td className="px-2 py-2">{bytes(slice.bytesSent)}</td>
                    <td className="px-2 py-2">{bytes(slice.bytesReceived)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
