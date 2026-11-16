"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      router.replace("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "האיפוס נכשל");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4">
      <form className="grid w-full gap-4 rounded-2xl bg-card p-6" onSubmit={(event) => void submit(event)}>
        <div>
          <h1 className="text-2xl font-medium">סיסמה חדשה</h1>
          <p className="mt-1 text-sm text-muted-foreground">בחרו סיסמה לכניסה לאתר. הקישור תקף לחצי שעה.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="new-password">סיסמה חדשה</Label>
          <Input id="new-password" dir="ltr" className="h-11 text-left" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm-password">אימות סיסמה</Label>
          <Input id="confirm-password" dir="ltr" className="h-11 text-left" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!token ? <p className="text-sm text-destructive">הקישור לא תקין. בקשו קישור חדש ממסך ההתחברות.</p> : null}
        <Button type="submit" className="h-11 rounded-xl" disabled={pending || !token}>
          {pending ? "שומר…" : "שמירת הסיסמה"}
        </Button>
      </form>
    </main>
  );
}
