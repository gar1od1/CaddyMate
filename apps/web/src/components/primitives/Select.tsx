'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { placePopover, type Placement } from './anchor';
import { filterOptions, moveActive, type SelectOption } from './select-logic';

export type { SelectOption } from './select-logic';

const ROW_H = 36;
const LIST_MAX_H = 288;

/**
 * The dropdown (docs/standards/web-ui.md §5): a single-value ARIA combobox.
 * Click or focus and type — the options narrow live on label and hint —
 * then arrows, Home/End, Enter to pick, Escape to close. `name` adds a
 * hidden input so it posts in a plain form. The list is positioned fixed so
 * a scrolling table frame or side panel cannot clip it, and flips above the
 * field when there is more room there.
 */
export function Select({
  options,
  value,
  onChange,
  id,
  name,
  placeholder = 'Choose…',
  emptyMessage = 'No matches',
  disabled = false,
  required = false,
  size = 'md',
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: {
  options: readonly SelectOption[];
  /** The chosen option's value; '' when nothing is chosen (or pass an option with value ''). */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<(Placement & { width: number }) | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => filterOptions(options, query), [options, query]);

  const measure = (count: number) => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const height = Math.min(LIST_MAX_H, Math.max(1, count) * ROW_H + 8);
    setPlace({
      ...placePopover(
        r,
        { width: r.width, height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
      width: r.width,
    });
  };

  const openList = (nextQuery = '') => {
    const list = filterOptions(options, nextQuery);
    const sel = list.findIndex((o) => o.value === value);
    setQuery(nextQuery);
    setActive(sel >= 0 && !nextQuery ? sel : moveActive(list, -1, 'first'));
    setOpen(true);
    measure(list.length);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (o: SelectOption | undefined) => {
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    close();
  };

  // Outside press closes; scrolling or resizing re-anchors the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!inputRef.current?.parentElement?.contains(t) && !listRef.current?.contains(t)) {
        setOpen(false);
        setQuery('');
      }
    };
    const onMove = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const height = listRef.current?.offsetHeight ?? LIST_MAX_H;
      setPlace({
        ...placePopover(r, { width: r.width, height }, { width: innerWidth, height: innerHeight }),
        width: r.width,
      });
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) openList(query);
        else setActive((a) => moveActive(shown, a, e.key === 'ArrowDown' ? 1 : -1));
        break;
      }
      case 'Home':
      case 'End':
        if (open) {
          e.preventDefault();
          setActive(moveActive(shown, active, e.key === 'Home' ? 'first' : 'last'));
        }
        break;
      case 'Enter':
        if (open) {
          e.preventDefault();
          choose(shown[active]);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        if (open) close();
        break;
    }
  };

  const activeId = open && active >= 0 && shown[active] ? `${listId}-${String(active)}` : undefined;

  return (
    <div className={`select ${className ?? ''}`} data-size={size}>
      <input
        ref={inputRef}
        id={inputId}
        className="select-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        placeholder={open ? (selected?.label ?? placeholder) : placeholder}
        onChange={(e) => {
          const q = e.target.value;
          const list = filterOptions(options, q);
          setQuery(q);
          setActive(moveActive(list, -1, 'first'));
          if (!open) {
            setOpen(true);
            measure(list.length);
          }
        }}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      />
      <span className="select-caret">
        <Icon name="chevron-down" size={16} />
      </span>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {open && place ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={ariaLabelledBy}
          aria-label={ariaLabelledBy ? undefined : ariaLabel}
          className="popover select-list"
          style={{
            top: place.top,
            bottom: place.bottom,
            left: place.left,
            minWidth: place.width,
            maxHeight: Math.min(LIST_MAX_H, place.maxHeight),
          }}
        >
          {shown.length === 0 ? (
            <li className="select-empty" role="presentation">
              {emptyMessage}
            </li>
          ) : (
            shown.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${String(i)}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                data-active={i === active || undefined}
                className="select-option"
                onPointerDown={(e) => e.preventDefault()}
                onPointerMove={() => i !== active && !o.disabled && setActive(i)}
                onClick={() => choose(o)}
              >
                <span>{o.label}</span>
                {o.hint ? <span className="select-hint">{o.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
