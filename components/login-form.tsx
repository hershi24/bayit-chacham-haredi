"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MarketingLanding } from "@/components/marketing-landing";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";
import type { SessionUser } from "@/lib/types";

const accounts = [
  ["מנהל", "admin", "pikud-admin"],
  ["ישיבה", "yeshiva", "yeshiva-1"],
  ["בית כנסת", "shul", "shul-2"],
];

export function LoginForm({ fontClass }: { fontClass: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api<{ user: SessionUser }>("/api/auth/me")
      .then(() => {
        router.replace("/");
      })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#login") setOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ההתחברות נכשלה");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <MarketingLanding fontClass={fontClass} onLogin={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>התחברות למערכת</DialogTitle>
            <DialogDescription>כל לקוח רואה רק את השקעים שמשויכים אליו.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <div className="grid gap-2">
              <Label htmlFor="username">שם משתמש</Label>
              <Input id="username" dir="ltr" className="h-11 text-left" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">סיסמה</Label>
              <Input id="password" dir="ltr" className="h-11 text-left" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending} className="h-11 rounded-xl">
              {pending ? "נכנסים" : "כניסה"}
            </Button>
          </form>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">חשבונות הדגמה</p>
            <ul className="mt-1 grid gap-1">
              {accounts.map(([label, user, pass]) => (
                <li key={user}>
                  {label}: <span className="font-mono text-foreground" dir="ltr">{user}</span>
                  {" / "}
                  <span className="font-mono text-foreground" dir="ltr">{pass}</span>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
