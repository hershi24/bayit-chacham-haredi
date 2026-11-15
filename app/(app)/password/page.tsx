import { PasswordForm } from "@/components/password-form";
import { pageUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function PasswordPage() {
  const user = await pageUser();
  if (user.role === "admin") redirect("/admin");
  return <PasswordForm />;
}
