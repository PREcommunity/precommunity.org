'use client';

import { useState } from 'react';
import { Copy, ExternalLink, Link as LinkIcon, Unlink } from 'lucide-react';
import type { AdminGoalDraft } from '@/lib/admin-workspace-types';
import { ActionButton } from './action-button';
import { textInputClass } from './form-control-classes';

export function AdminGoalPreviewLink({
  draft,
  editing,
  canManage,
  onChange,
}: {
  draft: AdminGoalDraft;
  editing: boolean;
  canManage: boolean;
  onChange: (enabled: boolean) => Promise<boolean>;
}) {
  const [pending, setPending] = useState(false);
  const [copyResult, setCopyResult] = useState<{
    path: string;
    url: string;
    copied: boolean;
  } | null>(null);
  const path = draft.previewPath;
  const result = copyResult?.path === path ? copyResult : null;
  const canCreate = canManage && (draft.status === 'DRAFT' || draft.status === 'PENDING_CHAIN');
  if (draft.status === 'ARCHIVED' || (!path && !canCreate)) return null;

  async function changeSharing(enabled: boolean) {
    setPending(true);
    setCopyResult(null);
    try {
      await onChange(enabled);
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    if (!path) return;
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopyResult({ path, url, copied: true });
    } catch {
      setCopyResult({ path, url, copied: false });
    }
  }

  return (
    <div className="col-span-full border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {path ? (
          <>
            <ActionButton
              type="button"
              size="compact"
              icon={<ExternalLink size={14} />}
              disabled={editing || pending}
              onClick={() => window.open(path, '_blank', 'noopener,noreferrer')}
            >
              Open preview
            </ActionButton>
            <ActionButton
              type="button"
              size="compact"
              icon={<Copy size={14} />}
              disabled={editing || pending}
              onClick={() => void copyLink()}
            >
              Copy link
            </ActionButton>
            {canManage ? (
              <ActionButton
                type="button"
                size="compact"
                variant="danger"
                icon={<Unlink size={14} />}
                disabled={pending}
                onClick={() => void changeSharing(false)}
              >
                Revoke link
              </ActionButton>
            ) : null}
          </>
        ) : (
          <ActionButton
            type="button"
            size="compact"
            icon={<LinkIcon size={14} />}
            disabled={editing || pending}
            onClick={() => void changeSharing(true)}
          >
            {pending ? 'Creating preview link…' : 'Create preview link'}
          </ActionButton>
        )}
        {editing ? <span className="text-[11px] text-muted">Save edits first</span> : null}
      </div>
      <p className="mb-0 mt-2 text-[11px] text-muted">
        {path
          ? draft.status === 'PUBLISHED'
            ? 'This preview link now opens the published request.'
            : 'Anyone with this link can view the latest saved draft. It is not published.'
          : 'Share the saved draft for feedback before publishing.'}
      </p>
      {result && !editing ? (
        <div className="mt-2">
          <p className="my-1 text-[11px] text-muted" role="status">
            {result.copied
              ? 'Preview link copied.'
              : 'Could not copy automatically. Select and copy the URL below.'}
          </p>
          {!result.copied ? (
            <input
              className={`${textInputClass} max-w-[640px]`}
              aria-label="Preview URL"
              value={result.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
