import { PhonesBoard } from "@/components/phones-board";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function PhonesPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin");
  return <PhonesBoard />;
}
