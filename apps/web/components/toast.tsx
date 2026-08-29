'use client';

import { useEffect } from 'react';
import { Check, CircleX, X } from 'lucide-react';

export type ToastType = 'success' | 'error';

export interface ToastState {
  type: ToastType;
  message: string;
}

export function Toast({
  toast,
  onDismiss,
  duration = 3_500,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
  duration?: number;
}) {
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timeout);
  }, [toast, onDismiss, duration]);

  if (!toast) return null;

  const error = toast.type === 'error';
  const Icon = error ? CircleX : Check;
  return (
    <div
      className={`fixed right-4 bottom-4 z-50 flex w-72 items-center gap-2 border-l-2 px-3 py-2.5 text-xs shadow-lg sm:w-80 ${error ? 'border-danger bg-danger/10 text-danger' : 'border-blue bg-paper text-navy'}`}
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
    >
      <Icon size={16} className="shrink-0" />
      <span>{toast.message}</span>
      <button
        className="ml-auto inline-flex shrink-0 cursor-pointer border-0 bg-transparent p-0"
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        <X size={15} />
      </button>
    </div>
  );
}
