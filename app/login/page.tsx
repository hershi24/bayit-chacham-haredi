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
  description: "Kosher Smart Home – בית חכם מהפלאפון הכשר. שליטה במכשירי החשמל בשיחת טלפון, באתר ובתוכניות אוטומטיות, כולל תכנון מראש לשבתות ולמועדי ישראל. 058-329-6967",
};

export default function LoginPage() {
  return <LoginForm fontClass={assistant.variable} />;
}
