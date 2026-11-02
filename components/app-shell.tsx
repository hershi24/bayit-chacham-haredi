"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { SessionUser } from "@/lib/types";

const links = [
  { href: "/", label: "לוח שקעים" },
  { href: "/programs", label: "תוכניות" },
  { href: "/audit", label: "יומן פעולות" },
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

  const items = user?.role === "admin" ? [...links, { href: "/admin", label: "ניהול" }] : links;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 md:px-6">
      <header className="sticky top-0 z-20 -mx-4 mb-8 border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background">פ</span>
            <span className="text-base font-semibold tracking-tight">פיקד</span>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex rounded-lg border border-border bg-card p-1">
              {items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card py-1 ps-3 pe-1 text-sm">
              <span className="text-muted-foreground">{user?.name ?? "מתחבר"}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => void logout()} aria-label="יציאה">
                <LogOut />
              </Button>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 pb-10">{children}</main>
    </div>
  );
}
