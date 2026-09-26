/**
 * Page layout primitives (docs/standards/web-ui.md §6). The shell owns
 * `<main>`; a page is a `Page` with one `PageHeader` (its h1 and actions)
 * followed by its sections. Pages never render a back link or breadcrumb —
 * the TopBar's breadcrumb is derived from the URL.
 */
export function Page({
  width = 'default',
  className,
  children,
}: {
  /** narrow 768px · default 1024px · wide 1280px · full (maps, editors). */
  width?: 'narrow' | 'default' | 'wide' | 'full';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`page ${className ?? ''}`} data-width={width}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  /** One line under the title: context, not instructions. */
  description?: React.ReactNode;
  /** The page's own actions (New course, Refit all), right-aligned; they wrap on a phone. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="min-w-0">
        <h1>{title}</h1>
        {description ? <div className="text-muted text-sm">{description}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
