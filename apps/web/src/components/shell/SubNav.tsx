'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { activeView, viewHref, type NavNode } from '@/lib/nav/tree';

/**
 * Views of the deepest active section (docs/standards/web-ui.md §2.4): the
 * same URL with a different query string. Never a link to another section.
 * Renders nothing when the section has no views.
 */
export function SubNav({ node }: { node: NavNode | undefined }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (!node?.views?.length) return null;
  const search = new URLSearchParams(params.toString());
  const current = activeView(node, search);
  return (
    <nav className="shell-subnav" aria-label={`${node.label} views`}>
      <ul className="subnav-list scroll-x">
        {node.views.map((v) => (
          <li key={v.key}>
            <Link
              href={viewHref(node, v, pathname, search)}
              className="subnav-link"
              aria-current={v.key === current?.key ? 'page' : undefined}
              scroll={false}
            >
              {v.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
