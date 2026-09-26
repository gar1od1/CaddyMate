'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { PAGES, grantsForRole, type Grants, type PermissionKey } from '@caddymate/api';
import { canSeeNavItem, decidePage } from '@/lib/nav/access';
import { NAV_TREE, activeTrail, breadcrumbFor, isShellless, visibleTree } from '@/lib/nav/tree';
import { LeftNav } from './LeftNav';
import { DeniedNotice, NoAccess } from './NoAccess';
import { SubNav } from './SubNav';
import { TopBar } from './TopBar';
import { useNavCollapsed } from './nav-collapse';
import { lockScroll } from './scroll-lock';
import { useViewportTier } from './viewport';

const NAV_ID = 'shell-leftnav';

/** What the root layout hands the shell: the request's grants, as plain data. */
export interface ShellGrants {
  role: Grants['role'];
  keys: PermissionKey[];
}

/**
 * The signed-in chrome around every page (docs/standards/web-ui.md §2):
 * TopBar, LeftNav and SubNav, all read from the one nav tree and composed
 * through the request's grants (gate 2). Signed-out routes (`isShellless`)
 * render bare.
 */
export function AppShell({
  grants,
  children,
}: {
  grants: ShellGrants | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (isShellless(pathname)) return <>{children}</>;
  return (
    <Shell pathname={pathname} grants={grants}>
      {children}
    </Shell>
  );
}

function Shell({
  pathname,
  grants: plain,
  children,
}: {
  pathname: string;
  grants: ShellGrants | null;
  children: React.ReactNode;
}) {
  const tier = useViewportTier();
  const [collapsed, setCollapsed] = useNavCollapsed();
  // Open state is tied to the path it was opened on, so any navigation closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname && tier !== 'desktop';
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Grants come from the root layout, which does not re-render on client
  // navigation. After a client-side sign-in (sign-in → `/`) they still say
  // "signed out" (`role: null`): refresh once so the layout reloads them, and
  // meanwhile compose as a player with the client guard off (never more than
  // a player; the server guard ran on the full load).
  const router = useRouter();
  const stale = !plain?.role;
  const refreshed = useRef(false);
  useEffect(() => {
    if (!stale) refreshed.current = false;
    else if (!refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [stale, router]);
  const grants = useMemo<Grants>(
    () => (plain?.role ? { role: plain.role, keys: new Set(plain.keys) } : grantsForRole('player')),
    [plain],
  );
  const tree = useMemo(() => visibleTree(NAV_TREE, (k) => canSeeNavItem(k, grants)), [grants]);
  // A soft navigation to a denied page is caught here with the same grants and
  // the same decision as the layout's server guard (which only sees full
  // loads). RLS and gate 4 still guard the data.
  const decision = stale ? ({ kind: 'open' } as const) : decidePage(pathname, grants);
  const redirectTo = decision.kind === 'redirect' ? decision.to : null;
  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);
  const trail = useMemo(() => activeTrail(tree, pathname), [tree, pathname]);
  const crumbs = useMemo(() => breadcrumbFor(tree, pathname).slice(-5), [tree, pathname]);

  const close = () => setOpenAt(null);
  const dismiss = () => {
    close();
    if (tier === 'phone') menuButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const unlock = tier === 'phone' ? lockScroll() : () => undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenAt(null);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      unlock();
      document.removeEventListener('keydown', onKey);
    };
  }, [open, tier]);

  return (
    <div className="shell">
      <a href="#workspace" className="skip-link">
        Skip to content
      </a>
      <TopBar
        crumbs={crumbs}
        navId={NAV_ID}
        navOpen={open}
        onMenu={() => setOpenAt(open ? null : pathname)}
        menuButtonRef={menuButtonRef}
      />
      <div className="shell-body" data-collapsed={collapsed || undefined}>
        <div className="shell-leftnav-slot" />
        <LeftNav
          id={NAV_ID}
          tree={tree}
          trail={trail.map((n) => n.key)}
          collapsed={collapsed}
          open={open}
          modal={tier === 'phone'}
          compact={tier === 'desktop' ? collapsed : !open}
          onToggleCollapse={() =>
            tier === 'desktop' ? setCollapsed(!collapsed) : setOpenAt(open ? null : pathname)
          }
          onClose={close}
        />
        {open ? <div className="shell-backdrop" aria-hidden="true" onClick={dismiss} /> : null}
        <div className="shell-column">
          <Suspense fallback={null}>
            <SubNav node={trail.at(-1)} />
          </Suspense>
          <main id="workspace" className="shell-workspace" tabIndex={-1}>
            <Suspense fallback={null}>
              <DeniedNotice />
            </Suspense>
            {decision.kind === 'open' ? children : <NoAccess label={PAGES[decision.page].label} />}
          </main>
        </div>
      </div>
    </div>
  );
}
