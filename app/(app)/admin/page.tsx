import { AdminConsole } from "@/components/admin-console";
import { pageUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const user = await pageUser();
  if (user.role !== "admin") redirect("/phones");
  return <AdminConsole />;
}
