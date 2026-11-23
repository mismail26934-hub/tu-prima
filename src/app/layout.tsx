import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from './providers';
import './globals.css';

/* Design System TU Typography (Figma 1:5287) — Roboto (self-hosted) */
const roboto = localFont({
  src: [
    { path: '../fonts/Roboto-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/Roboto-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/Roboto-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PRIMA — Progress Report & Inspection for Mechanic Allocation',
  description:
    'Progress Report & Inspection for Mechanic Allocation — monitoring teknisi, progress job, dan durasi kerja',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.ico' },
};

export const viewport: Viewport = {
  themeColor: '#fdba12',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang='id' suppressHydrationWarning>
      <body className={roboto.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
