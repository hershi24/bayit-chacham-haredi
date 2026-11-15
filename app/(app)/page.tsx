import { Dashboard } from "@/components/dashboard";
import { pageUser } from "@/lib/session";

export default async function HomePage() {
  const user = await pageUser();
  return <Dashboard user={user} />;
}
