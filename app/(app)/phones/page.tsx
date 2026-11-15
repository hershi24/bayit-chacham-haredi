import { PhonesBoard } from "@/components/phones-board";
import { pageUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function PhonesPage() {
  const user = await pageUser();
  if (user.role === "admin") redirect("/admin");
  return <PhonesBoard />;
}
