import type { Metadata } from "next";
import { IBM_Plex_Mono, Rubik } from "next/font/google";
import { DirectionProvider } from "@/components/ui/direction";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const fontSans = Rubik({
  subsets: ["hebrew", "latin"],
  variable: "--font-sans",
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-mono",
});

export const metadata: Metadata = {
  title: "פיקד",
  description: "שליטה בשקעים חכמים SC1, באתר ובטלפון",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}>
      <body className="min-h-dvh bg-background text-foreground">
        <DirectionProvider direction="rtl">
          {children}
          <Toaster position="top-center" dir="rtl" />
        </DirectionProvider>
      </body>
    </html>
  );
}
