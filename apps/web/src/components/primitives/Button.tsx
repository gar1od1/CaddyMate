import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const cls = (variant: Variant, size: Size, extra?: string) =>
  [
    'btn',
    variant === 'primary' ? '' : `btn-${variant}`,
    size === 'lg' ? '' : `btn-${size}`,
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ');

/**
 * The one button (docs/standards/web-ui.md §6): primary for the page's main
 * action, secondary for the rest, danger for destructive ones. Meets the
 * 24px (44px on touch) target size from the `.btn` rule.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={cls(variant, size, className)} {...rest} />;
}

/** A link that looks like a button (navigates; use `Button` for actions). */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cls(variant, size, className)}>
      {children}
    </Link>
  );
}
