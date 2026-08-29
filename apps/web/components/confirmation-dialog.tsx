'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ActionButton } from './action-button';

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel, open, pending]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-100 grid place-items-center bg-navy/65 p-4 backdrop-blur-[2px] motion-safe:[animation:dialog-backdrop-in_.16s_ease-out_both]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <section
        className="w-full max-w-[420px] border border-navy bg-paper p-5 shadow-[0_22px_50px_rgba(9,28,51,.28)] motion-safe:[animation:dialog-in_.18s_cubic-bezier(.16,1,.3,1)_both]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-description"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="grid size-9 shrink-0 place-items-center border border-danger/30 bg-danger/10 text-danger">
            <AlertTriangle size={18} />
          </span>
          <button
            className="-mt-1 -mr-1 inline-flex size-8 cursor-pointer items-center justify-center border-0 bg-transparent text-muted transition-colors hover:text-navy disabled:cursor-not-allowed"
            type="button"
            aria-label="Close confirmation"
            disabled={pending}
            onClick={onCancel}
          >
            <X size={17} />
          </button>
        </div>
        <h2
          className="mt-4 mb-1 text-[21px] leading-tight tracking-[-.025em]"
          id="confirmation-title"
        >
          {title}
        </h2>
        <p
          className="m-0 max-w-[360px] text-[13px] leading-[1.55] text-muted"
          id="confirmation-description"
        >
          {description}
        </p>
        <div className="mt-6 flex justify-end gap-2 max-sm:grid max-sm:grid-cols-2">
          <ActionButton ref={cancelButtonRef} type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </ActionButton>
          <ActionButton variant="danger" type="button" disabled={pending} onClick={onConfirm}>
            {pending ? 'Working…' : confirmLabel}
          </ActionButton>
        </div>
      </section>
    </div>
  );
}
