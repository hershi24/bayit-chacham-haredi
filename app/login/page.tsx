import type { Metadata } from "next";
import { Assistant } from "next/font/google";
import { LoginForm } from "@/components/login-form";
import { siteDescription, siteTitle } from "@/lib/site";

const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-assistant",
});

export const metadata: Metadata = {
  title: { absolute: siteTitle },
  description: siteDescription,
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return <LoginForm fontClass={assistant.variable} />;
}
