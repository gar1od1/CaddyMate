import { Icon } from '@/components/shell/Icon';

/**
 * Shown instead of a desktop tool under 768px (docs/standards/web-ui.md
 * §3.4). Page content: it may say where to go, it never links to another
 * section. Pair with `.hide-sm` on the tool itself.
 */
export function DesktopOnlyNotice({
  what,
  children,
}: {
  what: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card show-sm-only m-3 flex flex-col items-center gap-2 text-center">
      <Icon name="monitor" size={32} />
      <p className="font-semibold">{what} needs a larger screen</p>
      <p className="text-muted text-sm">
        Open it on a tablet or computer. On the course, use the CaddyMate app.
      </p>
      {children}
    </div>
  );
}
