import { AdminConsole } from "@/components/admin-console";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/phones");
  return <AdminConsole />;
}
