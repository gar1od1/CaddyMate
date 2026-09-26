'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { NavNode } from '@/lib/nav/tree';
import { Icon } from './Icon';

/**
 * The app's section hierarchy (docs/standards/web-ui.md §2.3): up to three
 * levels, chevrons open a branch in place without navigating, the active
 * branch is open by default and the deepest matching row is lit.
 *
 * One component serves every tier; globals.css (`.shell-leftnav`) decides
 * whether it is the full rail (desktop), a 56px rail that overlays when
 * opened (tablet) or an off-canvas drawer (phone).
 */
export function LeftNav({
  id,
  tree,
  trail,
  collapsed,
  open,
  modal,
  compact,
  onToggleCollapse,
  onClose,
}: {
  id: string;
  tree: NavNode[];
  /** Keys from the top-level row down to the active node. */
  trail: string[];
  /** Desktop preference: icon-only rail. */
  collapsed: boolean;
  /** Tablet: rail expanded over the page. Phone: drawer shown. */
  open: boolean;
  /** Phone drawer: trap focus while open. */
  modal: boolean;
  /** Icon-only at this tier right now (drives the collapse tab's label). */
  compact: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const leaf = trail.at(-1);

  // Focus trap for the phone drawer; the shell restores focus on close.
  useEffect(() => {
    if (!modal || !open) return;
    const nav = ref.current;
    if (!nav) return;
    const focusables = () =>
      [...nav.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
        (el) => el.offsetParent !== null,
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els.at(-1)!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    nav.addEventListener('keydown', onKey);
    return () => nav.removeEventListener('keydown', onKey);
  }, [modal, open]);

  const rows = (nodes: NavNode[], depth: number) => (
    <ul className="nav-list" data-depth={depth}>
      {nodes.map((n) => {
        const hasChildren = !!n.children?.length;
        const inTrail = trail.includes(n.key);
        const expanded = hasChildren && (toggled[n.key] ?? inTrail);
        const isLeaf = n.key === leaf;
        const childId = `${id}-${n.key}`;
        return (
          <li key={n.key}>
            <div
              className="nav-row"
              data-depth={depth}
              data-active={isLeaf || undefined}
              data-in-trail={(inTrail && !isLeaf) || undefined}
            >
              {n.locked ? (
                <span className="nav-link" aria-disabled="true" title={`${n.label} (soon)`}>
                  <Icon name={n.icon} />
                  <span className="nav-label">{n.label}</span>
                  <span className="nav-soon">Soon</span>
                </span>
              ) : (
                <Link
                  href={n.route}
                  className="nav-link"
                  aria-current={isLeaf ? 'page' : undefined}
                  title={n.label}
                  data-label={n.label}
                  onClick={onClose}
                >
                  <Icon name={n.icon} />
                  <span className="nav-label">{n.label}</span>
                </Link>
              )}
              {hasChildren && !n.locked ? (
                <button
                  type="button"
                  className="nav-chevron"
                  aria-expanded={expanded}
                  aria-controls={childId}
                  aria-label={`${expanded ? 'Hide' : 'Show'} ${n.label} pages`}
                  onClick={() => setToggled((t) => ({ ...t, [n.key]: !expanded }))}
                >
                  <Icon name="chevron-down" size={16} />
                </button>
              ) : null}
            </div>
            {hasChildren && expanded && !n.locked && depth < 2 ? (
              <div id={childId}>{rows(n.children!, depth + 1)}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav
      ref={ref}
      id={id}
      aria-label="Main"
      className="shell-leftnav"
      data-collapsed={collapsed || undefined}
      data-open={open || undefined}
    >
      <div className="nav-scroll">{rows(tree, 0)}</div>
      <button
        type="button"
        className="nav-collapse"
        onClick={onToggleCollapse}
        aria-label={compact ? 'Expand menu' : 'Collapse menu'}
        aria-controls={id}
      >
        <Icon name={compact ? 'chevron-right' : 'chevron-left'} size={18} />
      </button>
    </nav>
  );
}
