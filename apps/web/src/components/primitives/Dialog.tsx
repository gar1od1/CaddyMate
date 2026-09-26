'use client';

import { useEffect, useId, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { lockScroll } from '@/components/shell/scroll-lock';
import { Button } from './Button';
import { FOCUSABLE_SELECTOR, trapIndex } from './dialog-logic';

interface DialogProps {
  open: boolean;
  /** Escape, a press on the backdrop, or a Cancel button. */
  onClose: () => void;
  title: React.ReactNode;
  /** Linked by `aria-describedby`. */
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Buttons, right-aligned under the body. */
  actions?: React.ReactNode;
  /** Focused on open; defaults to the first focusable in the dialog. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog';
  /** False while an action is running: Escape and the backdrop do nothing. */
  dismissible?: boolean;
  className?: string;
}

/**
 * A modal dialog (docs/standards/web-ui.md §3.5, §6): portalled to `body`,
 * `aria-modal` with a labelled title, the rest of the page `inert`, focus
 * trapped inside (Tab wraps), Escape and a backdrop press close it, body
 * scroll locked, and focus returned to the opener on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  initialFocusRef,
  role = 'dialog',
  dismissible = true,
  className,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const live = useRef({ onClose, dismissible });
  useEffect(() => {
    live.current = { onClose, dismissible };
  });

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    const opener = document.activeElement as HTMLElement | null;
    const release = lockScroll();

    // Everything else in <body> is inert while the dialog is open.
    const inerted: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el !== root && el instanceof HTMLElement && !el.inert) {
        el.inert = true;
        inerted.push(el);
      }
    }

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0,
      );
    (initialFocusRef?.current ?? focusables()[0] ?? panel).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (live.current.dismissible) live.current.onClose();
      } else if (e.key === 'Tab') {
        const list = focusables();
        const next = trapIndex(
          list.length,
          list.indexOf(document.activeElement as HTMLElement),
          e.shiftKey,
        );
        if (list.length === 0) {
          e.preventDefault();
          panel.focus();
        } else if (next != null) {
          e.preventDefault();
          list[next]!.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      for (const el of inerted) el.inert = false;
      release();
      if (opener?.isConnected) opener.focus();
    };
  }, [open, initialFocusRef]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`card max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto shadow-xl ${className ?? ''}`}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? (
          <div id={descId} className="text-muted text-sm">
            {description}
          </div>
        ) : null}
        {children}
        {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A yes/no confirmation in place of `window.confirm`. Destructive ones
 * (`tone="danger"`) open with focus on Cancel so Enter does not delete.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: React.ReactNode;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      role="alertdialog"
      title={title}
      description={message}
      initialFocusRef={tone === 'danger' ? cancelRef : confirmRef}
      actions={
        <>
          <Button ref={cancelRef} variant="secondary" size="md" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="md"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
