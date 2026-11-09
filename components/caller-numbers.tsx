"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CallerNumber } from "@/lib/types";

export type CallerNumberInput = { phone: string; label?: string | null };

export function CallerNumbers({
  numbers,
  onAdd,
  onRemove,
  onUpdate,
}: {
  numbers: CallerNumber[];
  onAdd: (input: CallerNumberInput) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onUpdate: (id: string, input: { label: string | null }) => Promise<void>;
}) {
  const phoneFieldId = useId();
  const labelFieldId = useId();
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  async function add() {
    setPending(true);
    try {
      await onAdd({ phone, label: label.trim() || null });
      setPhone("");
      setLabel("");
    } catch {
      // The caller shows the error.
    } finally {
      setPending(false);
    }
  }

  function startEdit(item: CallerNumber) {
    setEditId(item.id);
    setEditLabel(item.label ?? "");
  }

  async function saveEdit(id: string) {
    setPending(true);
    try {
      await onUpdate(id, { label: editLabel.trim() || null });
      setEditId(null);
    } catch {
      // The caller shows the error.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor={phoneFieldId}>מספר נוסף</Label>
            <Input
              id={phoneFieldId}
              dir="ltr"
              className="text-left"
              inputMode="tel"
              placeholder="0520000000"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add();
                }
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={labelFieldId}>כינוי (רשות)</Label>
            <Input
              id={labelFieldId}
              placeholder="למשל אבא / משרד"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add();
                }
              }}
            />
          </div>
          <Button type="button" className="h-11" disabled={pending || phone.trim() === ""} onClick={() => void add()}>
            הוספה
          </Button>
        </div>
      </div>
      {numbers.length ? (
        <ul className="grid gap-2">
          {numbers.map((item) => (
            <li key={item.id} className="grid gap-2 rounded-xl bg-secondary px-3 py-2">
              {editId === item.id ? (
                <div
                  className="grid gap-2"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveEdit(item.id);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditId(null);
                    }
                  }}
                >
                  <Label htmlFor={`edit-label-${item.id}`}>כינוי</Label>
                  <Input
                    id={`edit-label-${item.id}`}
                    value={editLabel}
                    autoFocus
                    placeholder="למשל אבא / משרד"
                    onChange={(event) => setEditLabel(event.target.value)}
                  />
                  <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                    {item.phone}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <Button type="button" size="sm" disabled={pending} onClick={() => void saveEdit(item.id)}>
                      שמירת כינוי
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditId(null)}>
                      ביטול
                    </Button>
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    {item.label ? <span className="block truncate text-sm font-medium">{item.label}</span> : null}
                    <span dir="ltr" className="block truncate text-left font-mono text-sm">
                      {item.phone}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => startEdit(item)}>
                      כינוי
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 text-destructive"
                      disabled={pending}
                      onClick={() => void onRemove(item.id)}
                    >
                      הסרה
                    </Button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">אין עדיין מספר מורשה. בלי מספר אי אפשר לחייג למערכת.</p>
      )}
    </div>
  );
}
