import { Check, CircleAlert, CircleX } from 'lucide-react';

export type StatusNoticeType = 'success' | 'error' | 'info';

export interface StatusNoticeState {
  type: StatusNoticeType;
  message: string;
}

export function StatusNotice({ notice }: { notice: StatusNoticeState | null }) {
  if (!notice) return null;

  const presentation = {
    success: { Icon: Check, className: 'border-blue bg-blue-soft' },
    error: { Icon: CircleX, className: 'border-danger bg-danger/10 text-danger' },
    info: { Icon: CircleAlert, className: 'border-blue bg-blue-soft' },
  }[notice.type];

  return (
    <div
      className={`my-3 flex items-center gap-2 border-l-2 px-3 py-2.5 text-xs ${presentation.className}`}
      role={notice.type === 'error' ? 'alert' : 'status'}
    >
      <presentation.Icon size={16} />
      {notice.message}
    </div>
  );
}
