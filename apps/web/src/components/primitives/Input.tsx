import { useId } from 'react';

/**
 * A labelled text field (docs/standards/web-ui.md §3.5): a visible label,
 * optional hint and error linked by `aria-describedby`, `aria-invalid` on
 * error, and 16px text on a phone (globals.css) so iOS does not zoom.
 */
export function Input({
  label,
  hint,
  error,
  id,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="field-label">
        {label}
        {rest.required ? <span className="text-faint"> (required)</span> : null}
      </label>
      <input
        id={inputId}
        className="input"
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
