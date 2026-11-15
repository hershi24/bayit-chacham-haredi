import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { pageUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await pageUser();
  return <AppShell user={user}>{children}</AppShell>;
}
