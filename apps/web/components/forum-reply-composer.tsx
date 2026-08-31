'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ForumReply } from '@precommunity/shared';
import { ActionButton } from './action-button';
import { FormFieldError, useFormValidation } from './form-validation';
import { ForumMarkdownEditor } from './forum-markdown';

interface ForumReplyComposerProps {
  replyingTo: ForumReply | null;
  pending: boolean;
  minimumPre: string;
  onCancelReply: () => void;
  onSubmit: (body: string, parentReplyId?: string) => Promise<boolean>;
}

export function ForumReplyComposer({
  replyingTo,
  pending,
  minimumPre,
  onCancelReply,
  onSubmit,
}: ForumReplyComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [editorKey, setEditorKey] = useState(0);
  const validation = useFormValidation();

  useEffect(() => {
    if (!replyingTo) return;
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    formRef.current?.querySelector('textarea')?.focus();
  }, [replyingTo]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    if (await onSubmit(body, replyingTo?.id)) {
      form.reset();
      setEditorKey((value) => value + 1);
    }
  }

  return (
    <form
      className="my-[18px] mb-1 border-y border-line"
      onSubmit={(event) => void submit(event)}
      onInvalid={validation.onInvalid}
      onInput={validation.onInput}
      ref={formRef}
    >
      {replyingTo ? (
        <div className="mt-2 flex min-w-0 items-start justify-between gap-3 border-l-2 border-blue bg-blue-soft px-2 py-1.5 text-[10px]">
          <span className="min-w-0 flex-1">
            Replying to{' '}
            <strong>
              {replyingTo.author.displayName ||
                `${replyingTo.author.address.slice(0, 6)}…${replyingTo.author.address.slice(-4)}`}
            </strong>
            <span className="block truncate text-muted">{replyingTo.body}</span>
          </span>
          <button
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted hover:text-navy max-sm:size-11"
            type="button"
            aria-label="Cancel reply"
            onClick={onCancelReply}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      <ForumMarkdownEditor
        key={editorKey}
        {...validation.fieldProps('body')}
        name="body"
        size="reply"
        minLength={2}
        maxLength={2000}
        required
        placeholder="Write a response…"
      />
      <FormFieldError {...validation.errorProps('body')} />
      <div className="flex items-center justify-between gap-4 border-t border-line py-2 max-sm:flex-col max-sm:items-stretch">
        <span className="text-[10px] text-muted">
          Requires a signed-in wallet with at least {minimumPre} PRE.
        </span>
        <ActionButton variant="primary" size="compact" disabled={pending}>
          Post response
        </ActionButton>
      </div>
    </form>
  );
}
