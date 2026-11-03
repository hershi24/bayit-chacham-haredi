"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (nextPassword !== confirmPassword) {
      toast.error("הסיסמאות אינן תואמות");
      return;
    }
    setPending(true);
    try {
      await api("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, nextPassword }),
      });
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      toast.success("הסיסמה עודכנה");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "עדכון הסיסמה נכשל");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-lg gap-4">
      <div>
        <h2 className="text-[28px] leading-[34px] font-normal">סיסמת כניסה</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          הסיסמה משמשת לכניסה לאתר. שינוי כאן לא משנה את המספרים שמותר להם לחייג.
        </p>
      </div>
      <form className="grid gap-3 rounded-[22px] bg-card p-4" onSubmit={(event) => void save(event)}>
        <div className="grid gap-2">
          <Label htmlFor="current-password">סיסמה נוכחית</Label>
          <Input
            id="current-password"
            dir="ltr"
            className="h-11 text-left"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="next-password">סיסמה חדשה</Label>
          <Input
            id="next-password"
            dir="ltr"
            className="h-11 text-left"
            type="password"
            autoComplete="new-password"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm-password">אימות סיסמה חדשה</Label>
          <Input
            id="confirm-password"
            dir="ltr"
            className="h-11 text-left"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        <Button type="submit" className="h-11" disabled={pending || currentPassword === "" || nextPassword === "" || confirmPassword === ""}>
          {pending ? "שומר…" : "שינוי סיסמה"}
        </Button>
      </form>
    </section>
  );
}
