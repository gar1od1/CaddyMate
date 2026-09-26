/** A surface section of a page, optionally titled, with its own actions. */
export function Card({
  title,
  actions,
  className,
  children,
  as: Tag = 'section',
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  as?: 'section' | 'div' | 'aside';
}) {
  return (
    <Tag className={`card flex flex-col gap-4 ${className ?? ''}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}
