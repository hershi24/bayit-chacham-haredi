"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, Power, Phone, Wrench } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client-api";
import type { SessionUser } from "@/lib/types";
import "./power-switch.css";

const accounts = [
  ["מנהל", "admin", "pikud-admin"],
  ["ישיבה", "yeshiva", "yeshiva-1"],
  ["בית כנסת", "shul", "shul-2"],
];

export function LoginForm() {
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
    <div className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4">
        <BrandLogo className="h-12 w-auto" />
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <Button type="button" className="h-11 rounded-full px-4" onClick={() => setOpen(true)}>
            התחברות למערכת
          </Button>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-5xl items-center gap-10 px-4 py-8 md:grid-cols-[minmax(0,1.1fr)_minmax(18rem,22rem)] md:py-16">
        <div>
          <p className="text-sm font-medium text-primary">בלי התקנה · בלי חשמלאי</p>
          <h1 className="mt-3 text-balance text-[34px] leading-[40px] font-semibold tracking-tight md:text-[44px] md:leading-[50px]">
            שקע חכם שנכנס לשקע שכבר יש בקיר
          </h1>
          <p className="mt-4 max-w-xl text-[17px] leading-7 text-muted-foreground">
            אין פתיחת קיר, אין חיווט חדש, ואין צורך להזמין חשמלאי. מחברים את השקע לשקע הקיים, מחברים אליו את המכשיר, ומשם מפעילים ומכבים מהאתר או בשיחת טלפון.
          </p>
          <Button type="button" className="mt-6 h-12 rounded-full px-6 text-base" onClick={() => setOpen(true)}>
            התחברות למערכת
          </Button>
        </div>
        <article className="mx-auto w-full max-w-sm rounded-[22px] bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid size-11 place-items-center rounded-xl border border-border">
                <Plug className="size-5" />
              </span>
              <div>
                <h2 className="text-[17px] font-semibold">כך נראה השקע</h2>
                <p className="text-sm text-muted-foreground">אחרי החיבור לקיר</p>
              </div>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">כבוי</span>
          </div>
          <p className="mt-4 text-sm">מחובר</p>
          <p className="mt-1 text-[17px]">הבא 13:00 דולק</p>
          <div className="mt-4 flex flex-col items-center">
            <div className="power-switch" data-state="off" aria-hidden="true">
              <span className="power-switch-ring" />
              <span className="power-switch-face">
                <Power className="size-8" strokeWidth={2.25} />
              </span>
            </div>
            <p className="mt-2 text-[13px] font-medium text-muted-foreground">כבוי</p>
          </div>
        </article>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-3 px-4 pb-8 md:grid-cols-3">
        <Value icon={Wrench} title="בלי חשמלאי" text="לא פותחים קיר ולא מחליפים תשתית. השקע יושב על שקע קיים, וכל אדם מחבר אותו לבד." />
        <Value icon={Plug} title="בלי התקנה" text="דקה אחת: השקע לקיר, המכשיר לשקע. מזגן, תאורה או דוד ממשיכים לעבוד כמו קודם." />
        <Value icon={Phone} title="שליטה גם בלי אתר" text="מהמערכת מפעילים, קובעים טיימר ותוכניות. אפשר גם לחייג ולעשות את זה בתפריט טלפון." />
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-16">
        <h2 className="text-[28px] leading-[34px] font-semibold">איך זה עובד</h2>
        <ol className="mt-4 grid list-none gap-3 md:grid-cols-3">
          <Step n="1" title="מחברים לקיר" text="השקע נכנס לשקע החשמל שכבר מותקן. אין קידוח ואין עבודת חשמל." />
          <Step n="2" title="מחברים את המכשיר" text="המכשיר עובר לשקע החכם. הוא נשאר מכשיר רגיל, רק שאפשר לכבות אותו מרחוק." />
          <Step n="3" title="נכנסים למערכת" text="כל לקוח רואה את השקעים שלו, מפעיל ומכבה, וקובע מתי הם עובדים." />
        </ol>
      </section>

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
    </div>
  );
}

function Value({ icon: Icon, title, text }: { icon: typeof Plug; title: string; text: string }) {
  return (
    <article className="rounded-[22px] bg-card p-4">
      <Icon className="size-5 text-primary" />
      <h2 className="mt-3 text-[17px] font-semibold">{title}</h2>
      <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{text}</p>
    </article>
  );
}

function Step({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <li className="rounded-[22px] bg-card p-4">
      <p className="text-sm font-medium text-primary">{n}</p>
      <h3 className="mt-1 text-[17px] font-semibold">{title}</h3>
      <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{text}</p>
    </li>
  );
}
