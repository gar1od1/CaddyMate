import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CaddyMate',
  description: 'Shot dispersion and course strategy.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
