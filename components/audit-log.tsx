"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/client-api";
import { formatIsrael } from "@/lib/time";
import type { AuditView } from "@/lib/types";

const sources: Record<AuditView["source"], string> = {
  web: "אתר",
  ivr: "טלפון",
  stream: "שידור",
  system: "מערכת",
};

function actionLabel(action: string) {
  if (action === "ON") return "הפעלה";
  if (action === "OFF") return "כיבוי";
  return action;
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const payload = await api<{ entries: AuditView[] }>("/api/audit");
      setEntries(payload.entries);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת היומן נכשלה");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">יומן פעולות</h2>
          <p className="text-sm text-muted-foreground">פקודות מהאתר ומהטלפון, ושינויים שהגיעו בשידור.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          רענון
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {entries && entries.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p>עוד אין פעולות. הפעלה או כיבוי של שקע ייכתבו לכאן, כולל מפתח הייחודיות.</p>
        </div>
      ) : null}
      {entries && entries.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>זמן</TableHead>
                <TableHead>מקור</TableHead>
                <TableHead>מבצע</TableHead>
                <TableHead>שקע</TableHead>
                <TableHead>פעולה</TableHead>
                <TableHead>תוצאה</TableHead>
                <TableHead>מפתח</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{formatIsrael(entry.at)}</TableCell>
                  <TableCell>{sources[entry.source] ?? entry.source}</TableCell>
                  <TableCell>{entry.actor}</TableCell>
                  <TableCell>
                    <div>{entry.deviceName ?? "—"}</div>
                    <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {entry.deviceId}
                    </div>
                  </TableCell>
                  <TableCell>{actionLabel(entry.action)}</TableCell>
                  <TableCell>
                    <div>{entry.result}</div>
                    {entry.detail ? <div className="max-w-48 truncate text-xs text-muted-foreground">{entry.detail}</div> : null}
                  </TableCell>
                  <TableCell className="max-w-36 truncate font-mono text-xs" dir="ltr">
                    {entry.idempotencyKey ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {entries === null && !error ? <div className="h-40 animate-pulse rounded-2xl border border-border bg-muted" /> : null}
    </section>
  );
}
