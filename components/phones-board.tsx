"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CallerNumbers } from "@/components/caller-numbers";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { CallerNumber } from "@/lib/types";

export function PhonesBoard() {
  const [phones, setPhones] = useState<CallerNumber[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const payload = await api<{ phones: CallerNumber[] }>("/api/account/phones");
      setPhones(payload.phones);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת המספרים נכשלה");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function add(phone: string) {
    try {
      const payload = await api<{ phones: CallerNumber[] }>("/api/account/phones", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setPhones(payload.phones);
      toast.success("המספר נוסף");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "ההוספה נכשלה");
      throw cause;
    }
  }

  async function remove(id: string) {
    if (!window.confirm("להסיר את המספר מהחיוג למערכת?")) return;
    try {
      const payload = await api<{ phones: CallerNumber[] }>(`/api/account/phones/${id}`, { method: "DELETE" });
      setPhones(payload.phones);
      toast.success("המספר הוסר");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "ההסרה נכשלה");
    }
  }

  if (!phones && !error) return <div className="h-48 animate-pulse rounded-[22px] bg-card" />;
  if (error || !phones) {
    return (
      <section className="rounded-[22px] bg-card p-6">
        <p className="text-destructive">{error}</p>
        <Button className="mt-4 h-11" type="button" onClick={() => void load()}>
          נסו שוב
        </Button>
      </section>
    );
  }

  return (
    <section className="mx-auto grid max-w-lg gap-4">
      <div>
        <h2 className="text-[28px] leading-[34px] font-normal">מספרים לחיוג</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          המספרים האלה יכולים לחייג למערכת הקולית ולשלוט בשקעים שלכם. אפשר להוסיף מספר ולהסיר אותו.
        </p>
      </div>
      <div className="rounded-[22px] bg-card p-4">
        <CallerNumbers numbers={phones} onAdd={add} onRemove={remove} />
      </div>
    </section>
  );
}
