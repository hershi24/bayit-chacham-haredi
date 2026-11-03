"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";
import type { SessionUser } from "@/lib/types";

const accounts = [
  ["מנהל", "admin", "pikud-admin"],
  ["ישיבה", "yeshiva", "yeshiva-1"],
  ["בית כנסת", "shul", "shul-2"],
];

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
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
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="mb-6">
        <BrandLogo className="h-auto w-full" />
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>התחברות</CardTitle>
          <CardDescription>כל לקוח רואה רק את השקעים שמשויכים אליו.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <div className="grid gap-2">
              <Label htmlFor="username">שם משתמש</Label>
              <Input
                id="username"
                dir="ltr"
                className="text-left"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">סיסמה</Label>
              <Input
                id="password"
                dir="ltr"
                className="text-left"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending} className="h-11 rounded-xl">
              {pending ? "נכנסים" : "כניסה"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <div className="mt-4 rounded-[22px] bg-card p-4 text-[15px]">
        <p className="font-medium">חשבונות הדגמה</p>
        <ul className="mt-2 grid gap-1 text-muted-foreground">
          {accounts.map(([label, user, pass]) => (
            <li key={user}>
              {label}: <span className="font-mono text-foreground" dir="ltr">{user}</span>
              {" / "}
              <span className="font-mono text-foreground" dir="ltr">{pass}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
