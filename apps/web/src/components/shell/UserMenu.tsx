'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Icon } from './Icon';

/** Identity and sign-out, the last item in the TopBar. */
export function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="topbar-button"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="user" />
        <span className="sr-only">Account</span>
        <span className="hide-md-down user-menu-email">{email ?? ''}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open ? (
        <div id="user-menu-panel" className="popover user-menu-panel">
          <p className="text-muted px-3 pt-2 pb-1 text-xs">Signed in as</p>
          <p className="truncate px-3 pb-2 text-sm">{email ?? '—'}</p>
          <button
            type="button"
            className="menu-item"
            onClick={async () => {
              await createClient().auth.signOut();
              router.replace('/sign-in');
              // Drop the root layout's grants for this user (AppShell).
              router.refresh();
            }}
          >
            <Icon name="sign-out" size={18} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
