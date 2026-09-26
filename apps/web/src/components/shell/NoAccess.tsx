'use client';

import { useSearchParams } from 'next/navigation';
import { DENIED_PARAM, deniedPageLabel } from '@/lib/nav/access';

const WHY = "Your account's role doesn't include this page. Ask an admin if you need it.";

/**
 * "Deny on the server, explain in the UI" (docs/standards/permissions.md
 * §6.6): rendered in place of a page the signed-in user may not open.
 */
export function NoAccess({ label }: { label: string | null }) {
  return (
    <div className="page" data-width="narrow">
      <div className="card m-3 flex flex-col gap-2" role="alert">
        <p className="font-semibold">You don&apos;t have access to {label ?? 'this page'}</p>
        <p className="text-muted text-sm">{WHY}</p>
      </div>
    </div>
  );
}

/**
 * The note on the page a denied user was redirected to (`?denied=<page>`,
 * set by the root layout's guard). Renders nothing without the parameter.
 */
export function DeniedNotice() {
  const label = deniedPageLabel(useSearchParams().get(DENIED_PARAM));
  if (!label) return null;
  return (
    <div className="card m-3 flex flex-col gap-1" role="status">
      <p className="font-semibold">You don&apos;t have access to {label}</p>
      <p className="text-muted text-sm">{WHY} You&apos;ve been brought here instead.</p>
    </div>
  );
}
