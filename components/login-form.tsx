"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MarketingLanding } from "@/components/marketing-landing";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";
import type { SessionUser } from "@/lib/types";

export function LoginForm({ fontClass }: { fontClass: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      const auth = new URLSearchParams(window.location.search).get("auth");
      if (auth === "google-unknown") {
        setOpen(true);
        setError("הדוא״ל של גוגל לא משויך לחשבון. שמרו אותו במסך הסיסמה, או בקשו מהמנהל.");
      } else if (auth === "google-unconfigured") {
        setOpen(true);
        setError("התחברות עם גוגל עדיין לא הוגדרה בשרת.");
      } else if (auth === "google-failed") {
        setOpen(true);
        setError("ההתחברות עם גוגל נכשלה. נסו שוב.");
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "forgot") {
        const result = await api<{ message: string }>("/api/auth/forgot", {
          method: "POST",
          body: JSON.stringify({ username }),
        });
        setNotice(result.message);
        return;
      }
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
            {mode === "login" ? (
              <>
                <a href="/api/auth/google" className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl")}>
                  <GoogleMark />
                  התחברות עם גוגל
                </a>
                <p className="text-center text-sm text-muted-foreground">או עם שם משתמש</p>
              </>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="username">{mode === "forgot" ? "שם משתמש או דוא״ל" : "שם משתמש"}</Label>
              <Input
                id="username"
                dir="ltr"
                className="h-11 text-left"
                autoComplete={mode === "forgot" ? "username" : "username"}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            {mode === "login" ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="password">סיסמה</Label>
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    שכחתי סיסמה
                  </button>
                </div>
                <Input id="password" dir="ltr" className="h-11 text-left" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">נשלח קישור לדוא״ל השמור בחשבון. הוא תקף לחצי שעה.</p>
            )}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
            <Button type="submit" disabled={pending} className="h-11 rounded-xl">
              {pending ? "רגע…" : mode === "forgot" ? "שליחת קישור" : "כניסה"}
            </Button>
            {mode === "forgot" ? (
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("login");
                  setNotice(null);
                  setError(null);
                }}
              >
                חזרה להתחברות
              </button>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z" />
      <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.6-1.9.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3z" />
      <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.3A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z" />
    </svg>
  );
}
