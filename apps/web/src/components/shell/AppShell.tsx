'use client';

import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { canSeeNavItem } from '@/lib/nav/access';
import { NAV_TREE, activeTrail, breadcrumbFor, isShellless, visibleTree } from '@/lib/nav/tree';
import { LeftNav } from './LeftNav';
import { SubNav } from './SubNav';
import { TopBar } from './TopBar';
import { useNavCollapsed } from './nav-collapse';
import { lockScroll } from './scroll-lock';
import { useViewportTier } from './viewport';

const NAV_ID = 'shell-leftnav';

/**
 * The signed-in chrome around every page (docs/standards/web-ui.md §2):
 * TopBar, LeftNav and SubNav, all read from the one nav tree. Signed-out
 * routes (`isShellless`) render bare.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isShellless(pathname)) return <>{children}</>;
  return <Shell pathname={pathname}>{children}</Shell>;
}

function Shell({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const tier = useViewportTier();
  const [collapsed, setCollapsed] = useNavCollapsed();
  // Open state is tied to the path it was opened on, so any navigation closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname && tier !== 'desktop';
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const tree = useMemo(() => visibleTree(NAV_TREE, canSeeNavItem), []);
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
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
