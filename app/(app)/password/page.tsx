import { PasswordForm } from "@/components/password-form";
import { pageUser } from "@/lib/session";
import { getUserEmail } from "@/lib/store";
import { redirect } from "next/navigation";

export default async function PasswordPage() {
  const user = await pageUser();
  if (user.role === "admin") redirect("/admin");
  const email = await getUserEmail(user.id);
  return <PasswordForm email={email} />;
}
