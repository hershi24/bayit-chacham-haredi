"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarRange, KeyRound, LayoutGrid, LogOut, Phone, ScrollText, Settings, type LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { SessionUser } from "@/lib/types";

const links: Array<{ href: string; label: string; short: string; icon: LucideIcon }> = [
  { href: "/", label: "לוח שקעים", short: "שקעים", icon: LayoutGrid },
  { href: "/programs", label: "תוכניות", short: "תוכניות", icon: CalendarRange },
  { href: "/audit", label: "יומן פעולות", short: "יומן", icon: ScrollText },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    void api<{ user: SessionUser }>("/api/auth/me")
      .then((payload) => setUser(payload.user))
      .catch(() => undefined);
    const onUnauthorized = () => router.replace("/login");
    window.addEventListener("pikud:unauthorized", onUnauthorized);
    return () => window.removeEventListener("pikud:unauthorized", onUnauthorized);
  }, [router]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const items =
    user?.role === "admin"
      ? [...links, { href: "/admin", label: "ניהול", short: "ניהול", icon: Settings }]
      : user
        ? [
            ...links,
            { href: "/phones", label: "מספרים לחיוג", short: "מספרים", icon: Phone },
            { href: "/password", label: "סיסמת כניסה", short: "סיסמה", icon: KeyRound },
          ]
        : links;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hig-bar sticky top-0 z-20 hidden h-dvh flex-col border-e border-border px-3 py-4 md:flex">
        <Link href="/" aria-label="Kosher Smart Home" className="block rounded-2xl bg-white px-2 py-1.5">
          <BrandLogo className="h-auto w-full" />
        </Link>
        <nav className="mt-6 grid gap-1">
          {items.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-[15px] ${
                  active ? "bg-secondary font-semibold text-primary" : "text-foreground hover:bg-secondary/70"
                }`}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto grid gap-2 px-2 pt-4">
          <ThemeToggle />
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{user?.name ?? "מתחבר"}</span>
            <Button variant="ghost" size="icon" className="size-11" onClick={() => void logout()} aria-label="יציאה">
              <LogOut />
            </Button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="hig-bar sticky top-0 z-20 flex items-center justify-between border-b border-border px-4 py-2 md:hidden">
          <Link href="/" aria-label="Kosher Smart Home" className="rounded-xl bg-white px-2 py-1">
            <BrandLogo className="h-11 w-auto" />
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle compact />
            <Button variant="ghost" className="h-11 px-3" onClick={() => void logout()} aria-label="יציאה">
              <LogOut />
              יציאה
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-12">{children}</main>
        <nav className="hig-bar fixed inset-x-3 bottom-3 z-30 grid grid-flow-col rounded-[28px] border border-border p-1 md:hidden" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
          {items.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-[22px] px-1 text-[11px] leading-[13px] ${
                  active ? "bg-secondary font-semibold text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="size-5" />
                {item.short}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
