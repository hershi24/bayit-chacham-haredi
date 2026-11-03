"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
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
    <div className="relative min-h-dvh overflow-hidden bg-[#f3f7fd] text-[#10233f] dark:bg-[#070b12] dark:text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-[-14%] size-[640px] rounded-full bg-[#b7d4ff]/80 blur-3xl dark:bg-[#1a4d96]/45" />
        <div className="absolute top-16 right-[-12%] size-[460px] rounded-full bg-[#d7f6e4]/90 blur-3xl dark:bg-[#0f3d28]/50" />
        <div className="absolute bottom-[-12%] left-[18%] size-[380px] rounded-full bg-[#e7eeff] blur-3xl dark:bg-[#10182c]" />
      </div>

      <header className="sticky top-0 z-20 border-b border-white/50 bg-[#f3f7fd]/75 backdrop-blur-xl dark:border-white/10 dark:bg-[#070b12]/70">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <span className="rounded-2xl bg-white px-2 py-1 shadow-sm">
            <BrandLogo className="h-10 w-auto md:h-11" />
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <Button type="button" className="h-11 rounded-full px-4 shadow-[0_8px_18px_rgb(0_96_223/25%)]" onClick={() => setOpen(true)}>
              התחברות למערכת
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pt-8 pb-16 md:px-6 md:pt-12">
        <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-6">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-[13px] font-medium text-[#0060df] shadow-sm ring-1 ring-[#0060df]/12 dark:bg-white/10 dark:text-[#8ebfff] dark:ring-white/10">
              <span className="size-1.5 rounded-full bg-[#187a34] shadow-[0_0_0_4px_rgb(24_122_52/18%)]" />
              שקע חכם לבית, בלי עבודת חשמל
            </p>
            <h1 className="mt-5 text-[2.45rem] leading-[1.05] font-semibold tracking-tight md:text-[3.55rem]">
              נכנס לשקע
              <span className="mt-1 block text-[#0060df] dark:text-[#79b4ff]">שכבר יש בקיר.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-8 text-[#3a3a3c] md:text-[18px] dark:text-[#d1d1d6]">
              אין קידוח, אין חיווט, ואין צורך בחשמלאי. מחברים את השקע לשקע הקיים, מחברים אליו מזגן, תאורה או דוד, ומפעילים מהאתר או בשיחת טלפון.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button type="button" className="h-12 rounded-full px-7 text-base shadow-[0_12px_28px_rgb(0_96_223/32%)]" onClick={() => setOpen(true)}>
                התחברות למערכת
              </Button>
              <p className="text-sm text-[#636366] dark:text-[#aeaeb2]">16A · 250V · שקע ישראלי רגיל</p>
            </div>
          </div>

          <figure className="relative mx-auto w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[460px]">
            <div aria-hidden="true" className="absolute inset-x-[6%] top-[8%] bottom-[7%] rounded-full bg-[radial-gradient(closest-side,#ffffff_0%,#c9ddff_58%,transparent_100%)] dark:bg-[radial-gradient(closest-side,#1a3f73_0%,transparent_72%)]" />
            <div aria-hidden="true" className="absolute inset-x-[20%] bottom-[5%] h-10 rounded-full bg-[#10233f]/12 blur-md dark:bg-black/50" />
            <Image
              src="/product/socket.png"
              alt="שקע Kosher Smart Home, לבן, עם שקע ישראלי 16 אמפר. מתחבר לשקע קיים בלי התקנה."
              width={867}
              height={1162}
              priority
              sizes="(min-width: 1024px) 460px, 80vw"
              className="socket-float relative h-auto w-full drop-shadow-[0_18px_24px_rgb(16_35_63/10%)]"
            />
          </figure>
        </section>

        <section className="mt-6 overflow-hidden rounded-[28px] bg-white shadow-[0_24px_60px_rgb(16_35_63/8%)] ring-1 ring-[#d7e1ef] md:mt-10 dark:bg-[#121820] dark:shadow-none dark:ring-white/10">
          <div className="grid md:grid-cols-3 md:[&>*+*]:border-s md:[&>*+*]:border-[#e6edf6] dark:md:[&>*+*]:border-white/10">
            <Fact index="01" title="בלי חשמלאי" text="לא פותחים קיר ולא מזמינים בעל מקצוע. השקע יושב על שקע שכבר מותקן." />
            <Fact index="02" title="דקה אחת" text="השקע לקיר, המכשיר לשקע. המזגן והתאורה נשארים אותם מכשירים." />
            <Fact index="03" title="גם מהטלפון" text="הדלקה, כיבוי, טיימר ותוכניות באתר, או בשיחה קצרה לתפריט." />
          </div>
        </section>
      </main>

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

function Fact({ index, title, text }: { index: string; title: string; text: string }) {
  return (
    <article className="border-t border-[#e6edf6] px-6 py-6 first:border-t-0 md:border-t-0 md:px-7 md:py-8 dark:border-white/10">
      <p className="text-[13px] font-semibold tracking-[0.14em] text-[#0060df] dark:text-[#8ebfff]">{index}</p>
      <h2 className="mt-2 text-[22px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-sm text-[15px] leading-7 text-[#636366] dark:text-[#aeaeb2]">{text}</p>
    </article>
  );
}
