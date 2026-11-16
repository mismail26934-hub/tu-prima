import type { Metadata, Viewport } from 'next';
import { Roboto } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

/* Design System TU Typography (Figma 1:5287) — Roboto */
const roboto = Roboto({
  subsets: ['latin'],
  /* Roboto static faces: 400 Regular, 500 Medium (~Semibold), 700 Bold */
  weight: ['400', '500', '700'],
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
