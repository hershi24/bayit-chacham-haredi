import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  return <AppShell user={user}>{children}</AppShell>;
}
