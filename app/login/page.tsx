import type { Metadata } from "next";
import { Assistant } from "next/font/google";
import { LoginForm } from "@/components/login-form";

const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-assistant",
});

export const metadata: Metadata = {
  title: "Kosher Smart Home | בית חכם מהפלאפון הכשר",
  description: "Kosher Smart Home – שליטה במכשירי החשמל מהפלאפון הכשר וגם מהאתר. שקע חכם ללא צורך בחשמלאי להתקנה.",
};

export default function LoginPage() {
  return <LoginForm fontClass={assistant.variable} />;
}
