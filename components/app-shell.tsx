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
  { href: "/", label: "שקעים", short: "שקעים", icon: LayoutGrid },
  { href: "/programs", label: "תוכניות", short: "תוכניות", icon: CalendarRange },
  { href: "/audit", label: "יומן", short: "יומן", icon: ScrollText },
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
            { href: "/password", label: "סיסמה", short: "סיסמה", icon: KeyRound },
          ]
        : links;

  const frame = pathname === "/programs" ? "max-w-[1300px]" : pathname === "/" ? "max-w-7xl" : "max-w-5xl";

  return (
    <div className="flex min-h-dvh min-w-0 flex-col overflow-x-clip">
      <header className="app-bar sticky top-0 z-20 border-b border-border/70">
        <div className={`mx-auto flex h-14 w-full items-center gap-3 px-4 md:gap-6 md:px-8 ${frame}`}>
          <Link href="/" aria-label="Kosher Smart Home" className="shrink-0">
            <BrandLogo className="h-8 w-auto max-w-[8.75rem] dark:rounded-md dark:bg-white dark:px-1" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-xl px-3 py-1.5 text-[14px] transition-colors ${
                    active ? "bg-primary/12 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ms-auto flex items-center gap-1">
            <span className="hidden max-w-40 truncate px-2 text-[13px] text-muted-foreground sm:inline">{user?.name ?? ""}</span>
            <ThemeToggle compact className="h-8 rounded-full border-0 bg-transparent px-2.5 text-[13px] text-muted-foreground shadow-none" />
            <Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground" onClick={() => void logout()} aria-label="יציאה">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main
        className={`mx-auto w-full min-w-0 flex-1 px-4 pt-6 pb-[calc(8.75rem+env(safe-area-inset-bottom,0px))] md:px-8 md:pt-10 md:pb-14 ${frame}`}
      >
        {children}
      </main>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 sm:px-4 md:hidden"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <nav aria-label="ניווט" className="app-bar pointer-events-auto grid w-full max-w-md auto-cols-[minmax(0,1fr)] grid-flow-col overflow-hidden rounded-2xl border border-border/80 p-1 shadow-[0_10px_24px_rgb(42_44_49/10%)]">
          {items.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] leading-[13px] ${
                  active ? "bg-primary/12 font-semibold text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="size-5 shrink-0" />
                <span className="max-w-full truncate">{item.short}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
