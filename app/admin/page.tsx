import { AdminConsole } from "@/components/admin-console";
import { AppShell } from "@/components/app-shell";

export default function AdminPage() {
  return (
    <AppShell>
      <AdminConsole />
    </AppShell>
  );
}
