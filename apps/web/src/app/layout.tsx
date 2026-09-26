import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'CaddyMate',
  description: 'Shot dispersion and course strategy.',
};

export const viewport: Viewport = {
  themeColor: '#0b1f14',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/* Signed-in pages get the shell; /sign-in and /auth render bare (lib/nav/tree.ts). */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
