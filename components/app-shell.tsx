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

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="hig-bar sticky top-0 z-20 border-b border-border/70">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4 md:px-8">
          <Link href="/" aria-label="Kosher Smart Home" className="shrink-0">
            <BrandLogo className="h-8 w-auto dark:rounded-md dark:bg-white dark:px-1" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-[14px] transition-colors ${
                    active ? "bg-foreground/[0.06] font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-14">{children}</main>
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
  );
}
