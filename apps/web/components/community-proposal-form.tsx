'use client';

import { FormEvent, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ApiError, clientApiJson } from '@/lib/http';
import { ActionButton } from './action-button';
import { FormFieldError, useFormValidation } from './form-validation';
import { StatusNotice } from './status-notice';

export function CommunityProposalForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const validation = useFormValidation();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('saving');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await clientApiJson<{ slug?: string }>(
        '/v1/community/proposals',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: form.get('title'),
            category: form.get('category'),
            description: form.get('description'),
          }),
        },
        'Proposal submission',
      );
      setState('saved');
      router.push('/community/proposals/mine');
      router.refresh();
    } catch (error) {
      setState('idle');
      setError(
        error instanceof ApiError && error.status === 401
          ? 'Connect and sign in with your wallet first.'
          : error instanceof Error
            ? error.message
            : 'The proposal could not be submitted.',
      );
    }
  }

  if (!open)
    return (
      <ActionButton
        variant="primary"
        icon={<Plus size={17} />}
        className="max-sm:w-full"
        onClick={() => setOpen(true)}
      >
        Propose an idea
      </ActionButton>
    );

  return (
    <form
      className="grid w-[min(760px,100%)] grid-cols-2 gap-3.5 border border-line p-[18px] max-sm:grid-cols-1"
      onSubmit={submit}
      onInvalid={validation.onInvalid}
      onInput={validation.onInput}
    >
      <header className="col-span-full flex justify-between gap-5 max-sm:col-auto">
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            New community proposal
          </span>
          <h2 className="my-1 text-[22px]">Put an idea forward.</h2>
        </div>
        <button
          className="self-start cursor-pointer border-0 bg-transparent"
          type="button"
          aria-label="Close form"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
      </header>
      <label className="flex flex-col gap-1.5">
        <span className="text-[9px] font-bold text-muted uppercase">Title</span>
        <input
          {...validation.fieldProps('title')}
          className="min-h-10 w-full rounded-[3px] border border-line bg-white px-2.5 py-2 text-navy"
          name="title"
          minLength={4}
          maxLength={120}
          required
          placeholder="A clear outcome for the community"
        />
        <FormFieldError {...validation.errorProps('title')} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[9px] font-bold text-muted uppercase">Category</span>
        <input
          {...validation.fieldProps('category')}
          className="min-h-10 w-full rounded-[3px] border border-line bg-white px-2.5 py-2 text-navy"
          name="category"
          maxLength={60}
          required
          placeholder="Infrastructure, content, research…"
        />
        <FormFieldError {...validation.errorProps('category')} />
      </label>
      <label className="col-span-full flex flex-col gap-1.5 max-sm:col-auto">
        <span className="text-[9px] font-bold text-muted uppercase">Idea</span>
        <textarea
          {...validation.fieldProps('description')}
          className="min-h-24 w-full resize-y rounded-[3px] border border-line bg-white px-2.5 py-2 text-navy"
          name="description"
          minLength={20}
          maxLength={5000}
          required
          placeholder="Explain the problem, the proposed outcome, and why it matters."
        />
        <FormFieldError {...validation.errorProps('description')} />
      </label>
      <div className="col-span-full flex items-center justify-between gap-5 max-sm:col-auto max-sm:flex-col max-sm:items-stretch">
        <p className="max-w-[440px] text-[11px] text-muted">
          Submitting and discussing requires at least 1 PRE. An approved proposal enters a seven-day
          vote.
        </p>
        <ActionButton
          variant="primary"
          icon={state === 'saved' ? <Check size={16} /> : null}
          disabled={state === 'saving'}
        >
          {state === 'saving' ? 'Checking PRE…' : 'Submit for review'}
        </ActionButton>
      </div>
      <div className="col-span-full max-sm:col-auto">
        <StatusNotice notice={error ? { type: 'error', message: error } : null} />
      </div>
    </form>
  );
}
