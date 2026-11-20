"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/client-api";
import { auditResultLabel, auditSucceeded } from "@/lib/audit-result";
import { formatIsrael } from "@/lib/time";
import type { AuditView, TenantView } from "@/lib/types";

type AuditPayload = {
  entries: AuditView[] | null;
  tenants?: TenantView[];
  tenantName?: string | null;
};

const sources: Record<AuditView["source"], string> = {
  web: "אתר",
  ivr: "טלפון",
  stream: "שידור",
  system: "מערכת",
};

function actionLabel(action: string) {
  if (action === "ON") return "הפעלה";
  if (action === "OFF") return "כיבוי";
  if (action === "CONTACT_REQUEST") return "פניה מהאתר";
  if (action === "ADMIN_REQUEST") return "בקשת חזרה";
  return action;
}

export function AuditLog({ initialTenantId = null }: { initialTenantId?: string | null }) {
  const [entries, setEntries] = useState<AuditView[] | null>(null);
  const [tenants, setTenants] = useState<TenantView[] | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(initialTenantId);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string | null) => {
    try {
      const query = id ? `?tenantId=${encodeURIComponent(id)}` : "";
      const payload = await api<AuditPayload>(`/api/audit${query}`);
      setTenants(payload.tenants ?? null);
      setTenantName(payload.tenantName ?? null);
      setEntries(payload.entries);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת היומן נכשלה");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(tenantId), 0);
    return () => window.clearTimeout(timer);
  }, [load, tenantId]);

  if (tenants && entries === null && !tenantId) {
    return (
      <section className="max-w-xl">
        <h2 className="text-2xl font-semibold tracking-tight">יומן לפי לקוח</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">בוחרים לקוח, ואז רואים רק את הפעולות של השקעים שלו.</p>
        <div className="mt-3 grid gap-2">
          {tenants.map((tenant) => (
            <button
              key={tenant.id}
              type="button"
              className="rounded-2xl border bg-card px-4 py-3 text-start hover:border-primary/40"
              onClick={() => setTenantId(tenant.id)}
            >
              <span className="block text-[15px] font-semibold">{tenant.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{tenant.deviceCount} התקנים · יומן הלקוח</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          {tenants ? (
            <button type="button" className="mb-1 text-[13px] font-medium text-primary" onClick={() => setTenantId(null)}>
              לקוח אחר
            </button>
          ) : null}
          <h2 className="text-2xl font-semibold tracking-tight">{tenantName ? `יומן · ${tenantName}` : "יומן פעולות"}</h2>
          <p className="text-sm text-muted-foreground">פקודות מהאתר ומהטלפון, ושינויים שהגיעו בשידור.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load(tenantId)}>
          רענון
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {entries && entries.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p>{tenantName ? `אין עדיין פעולות של ${tenantName}.` : "עוד אין פעולות. הפעלה או כיבוי של שקע ייכתבו לכאן, כולל מפתח הייחודיות."}</p>
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
                    <div className={auditSucceeded(entry.result) || entry.result === "SENT" ? undefined : "font-medium text-destructive"}>{auditResultLabel(entry.result)}</div>
                    {entry.detail ? (
                      <div
                        className={entry.action === "CONTACT_REQUEST" ? "max-w-72 text-xs whitespace-normal text-muted-foreground" : "max-w-48 truncate text-xs text-muted-foreground"}
                        title={entry.detail}
                      >
                        {entry.detail}
                      </div>
                    ) : null}
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
