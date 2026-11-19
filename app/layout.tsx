import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Rubik } from "next/font/google";
import { DirectionProvider } from "@/components/ui/direction";
import { Toaster } from "@/components/ui/sonner";
import { siteDescription, siteName, siteTitle, siteUrl } from "@/lib/site";
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

const shareImage = {
  url: "/brand/og.png",
  width: 1200,
  height: 630,
  alt: "Kosher Smart Home, בית חכם מהפלאפון הכשר",
  type: "image/png",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: siteName,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  applicationName: siteName,
  keywords: ["Kosher Smart Home", "בית חכם", "פלאפון כשר", "שקע חכם", "בקר ללוח החשמל"],
  authors: [{ name: siteName, url: "/login" }],
  creator: siteName,
  publisher: siteName,
  category: "בית חכם",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    type: "website",
    locale: "he_IL",
    url: "/login",
    siteName: siteName,
    title: siteTitle,
    description: siteDescription,
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [shareImage.url],
  },
};

export const viewport: Viewport = {
  themeColor: "#1766e0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("ksh-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-dvh bg-background text-foreground">
        <DirectionProvider direction="rtl">
          {children}
          <Toaster position="top-center" dir="rtl" />
        </DirectionProvider>
      </body>
    </html>
  );
}
