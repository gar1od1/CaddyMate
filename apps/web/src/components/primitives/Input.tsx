import { useId } from 'react';

/**
 * A labelled text field (docs/standards/web-ui.md §3.5): a visible label,
 * optional hint and error linked by `aria-describedby`, `aria-invalid` on
 * error, and 16px text on a phone (globals.css) so iOS does not zoom.
 * `density="sm"` is the compact size for desktop tool panels.
 */
export function Input({
  label,
  hint,
  error,
  id,
  className,
  inputClassName,
  density = 'md',
  ...rest
}: React.ComponentPropsWithRef<'input'> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  /** Extra classes on the `<input>` itself (the wrapper takes `className`). */
  inputClassName?: string;
  /** `sm` for dense tool panels such as the course editor (desktop-only). */
  density?: 'md' | 'sm';
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className={`field-label${density === 'sm' ? ' text-xs' : ''}`}>
        {label}
        {rest.required ? <span className="text-faint"> (required)</span> : null}
      </label>
      <input
        id={inputId}
        className={[
          'input',
          density === 'sm' ? 'rounded-lg px-2 py-1.5 text-sm' : '',
          inputClassName ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
