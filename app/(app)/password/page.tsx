import { PasswordForm } from "@/components/password-form";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function PasswordPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin");
  return <PasswordForm />;
}
