import { PAGES } from '@caddymate/api';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell, type ShellGrants } from '@/components/shell/AppShell';
import { NoAccess } from '@/components/shell/NoAccess';
import { getGrants } from '@/lib/auth/grants';
import { decidePage } from '@/lib/nav/access';
import { isShellless } from '@/lib/nav/tree';
import './globals.css';

export const metadata: Metadata = {
  title: 'CaddyMate',
  description: 'Shot dispersion and course strategy.',
};

export const viewport: Viewport = {
  themeColor: '#0b1f14',
  colorScheme: 'dark',
};

/**
 * Gates 2–3 (docs/standards/permissions.md §5). `proxy.ts` has already sent
 * signed-out visitors to /sign-in (gate 1) and stamped `x-pathname`; here the
 * request's grants are loaded once and the page guard runs. Layouts do not
 * re-render on client navigation, so this covers full loads and AppShell
 * repeats the check with the same grants on soft navigation.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get('x-pathname') ?? '/';
  let grants: ShellGrants | null = null;
  let page = children;
  if (!isShellless(path)) {
    const g = await getGrants();
    grants = { role: g.role, keys: [...g.keys] };
    // Only a signed-in user reaches here (role null = no session; the proxy owns that case).
    const decision = g.role ? decidePage(path, g) : ({ kind: 'open' } as const);
    // `redirect` throws: keep it outside any try/catch.
    if (decision.kind === 'redirect') redirect(decision.to);
    if (decision.kind === 'denied') page = <NoAccess label={PAGES[decision.page].label} />;
  }
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/* Signed-in pages get the shell; /sign-in and /auth render bare (lib/nav/tree.ts). */}
        <AppShell grants={grants}>{page}</AppShell>
      </body>
    </html>
  );
}
