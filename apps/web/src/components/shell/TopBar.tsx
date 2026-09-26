'use client';

import Link from 'next/link';
import type { Ref } from 'react';
import type { Crumb } from '@/lib/nav/tree';
import { Icon } from './Icon';
import { UserMenu } from './UserMenu';

/**
 * Global orientation (docs/standards/web-ui.md §2.2): the menu button (phone
 * and tablet), the logo — the only home link — the breadcrumb derived from
 * the URL, and the user menu. Nothing module-specific is added here.
 */
export function TopBar({
  crumbs,
  navId,
  navOpen,
  onMenu,
  menuButtonRef,
}: {
  crumbs: Crumb[];
  navId: string;
  navOpen: boolean;
  onMenu: () => void;
  menuButtonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <header className="shell-topbar">
      <button
        ref={menuButtonRef}
        type="button"
        className="topbar-button topbar-menu"
        aria-label={navOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={navOpen}
        aria-controls={navId}
        onClick={onMenu}
      >
        <Icon name={navOpen ? 'close' : 'menu'} />
      </button>
      <Link href="/" className="topbar-brand" aria-label="CaddyMate dashboard">
        <Icon name="brand" size={24} />
        <span className="hide-sm">CaddyMate</span>
      </Link>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          {crumbs.map((c, i) => {
            const fromEnd = crumbs.length - 1 - i;
            return (
              <li key={c.href} data-from-end={Math.min(fromEnd, 2)}>
                {fromEnd === 0 ? (
                  <span aria-current="page">{c.label}</span>
                ) : (
                  <Link href={c.href}>{c.label}</Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="topbar-spacer" />
      <UserMenu />
    </header>
  );
}
