"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CallerNumber } from "@/lib/types";

export function CallerNumbers({
  numbers,
  onAdd,
  onRemove,
}: {
  numbers: CallerNumber[];
  onAdd: (phone: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const fieldId = useId();
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);

  async function add() {
    setPending(true);
    try {
      await onAdd(phone);
      setPhone("");
    } catch {
      // The caller shows the error.
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-40 flex-1 gap-2">
          <Label htmlFor={fieldId}>מספר נוסף</Label>
          <Input
            id={fieldId}
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
        <Button type="button" className="h-11" disabled={pending || phone.trim() === ""} onClick={() => void add()}>
          הוספה
        </Button>
      </div>
      {numbers.length ? (
        <ul className="grid gap-2">
          {numbers.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-secondary px-3 py-2">
              <span dir="ltr" className="font-mono text-sm">{item.phone}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-destructive"
                onClick={() => void onRemove(item.id)}
              >
                הסרה
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">אין עדיין מספר מורשה. בלי מספר אי אפשר לחייג למערכת.</p>
      )}
    </div>
  );
}
