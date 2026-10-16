import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

/* Design System TU Typography (Figma 1:5287) — Inter */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PRIMA — Progress Report & Inspection for Mechanic Allocation",
  description:
    "Progress Report & Inspection for Mechanic Allocation — monitoring teknisi, progress job, dan durasi kerja",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  themeColor: "#fdba12",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className={inter.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
