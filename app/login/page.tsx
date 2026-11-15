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
  description: "Kosher Smart Home – מדליקים את הדוד, המזגן והתאורה בשיחה מהפלאפון הכשר או מהאתר. מוצרים עם תו תקן. 058-329-6967",
};

export default function LoginPage() {
  return <LoginForm fontClass={assistant.variable} />;
}
