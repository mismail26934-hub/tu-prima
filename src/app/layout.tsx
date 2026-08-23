import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Source_Sans_3 } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const display = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "PRIMA — Progress Report & Inspection for Mechanic Allocation",
  description:
    "Progress Report & Inspection for Mechanic Allocation — monitoring teknisi, progress job, dan durasi kerja",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#12151a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className={`${display.variable} ${body.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
