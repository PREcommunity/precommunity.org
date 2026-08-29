'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, LoaderCircle, Pencil } from 'lucide-react';
import type { CommunityProposal } from '@precommunity/shared';
import { ApiError, clientApiJson, clientApiRequest } from '@/lib/http';
import { textInputClass, textareaClass } from './form-control-classes';
import { FormFieldError, useFormValidation } from './form-validation';
import { StatusNotice, type StatusNoticeState } from './status-notice';

export function CommunitySubmissions() {
  const [items, setItems] = useState<CommunityProposal[]>([]);
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading');
  const [editing, setEditing] = useState<string>();
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const validation = useFormValidation();

  async function load() {
    try {
      setItems(
        await clientApiJson<CommunityProposal[]>(
          '/v1/community/submissions/mine',
          undefined,
          'Submissions',
        ),
      );
      setState('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState('signed-out');
        return;
      }
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Submissions could not be loaded.',
      });
      setState('ready');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await clientApiRequest(
        `/v1/community/proposals/${id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: form.get('title'),
            category: form.get('category'),
            description: form.get('description'),
          }),
        },
        'Proposal update',
      );
      setNotice({ type: 'success', message: 'Pending proposal updated.' });
      setEditing(undefined);
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Changes could not be saved.',
      });
    }
  }

  return (
    <main className="min-h-[70vh] px-[var(--page-pad)] pt-7 pb-[60px]">
      <Link
        href="/community/proposals"
        className="inline-flex items-center gap-1.5 text-xs text-blue"
      >
        <ArrowLeft size={16} /> Back to proposals
      </Link>
      <header className="max-w-[760px] py-[26px]">
        <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
          Private submission queue
        </span>
        <h1 className="mt-2.5 mb-2 text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-.04em]">
          Your proposals.
        </h1>
        <p className="m-0 text-muted">
          Pending ideas stay out of the public feed until a content moderator opens voting.
        </p>
      </header>
      <StatusNotice notice={notice} />
      {state === 'loading' ? (
        <div className="my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center">
          <LoaderCircle className="animate-spin" />
          <h2 className="mt-2.5 mb-1 text-2xl">Loading submissions</h2>
        </div>
      ) : state === 'signed-out' ? (
        <div className="my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center">
          <h2 className="mt-2.5 mb-1 text-2xl">Sign in to view submissions</h2>
          <p className="text-muted">Use the wallet control above.</p>
        </div>
      ) : (
        <section className="border-t border-navy">
          {items.length ? (
            items.map((proposal) => (
              <article
                className="grid grid-cols-[1fr_auto] gap-4 border-b border-line py-3.5 max-sm:grid-cols-1"
                key={proposal.id}
              >
                <div>
                  <small className="font-mono text-[9px] text-blue uppercase">
                    {proposal.status.replaceAll('_', ' ')}
                  </small>
                  <h2 className="my-[3px] text-[17px]">{proposal.title}</h2>
                  <p className="m-0 text-muted">{proposal.category}</p>
                </div>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  {proposal.status === 'PENDING_REVIEW' ? (
                    <button
                      className="min-h-8 cursor-pointer border border-navy bg-white px-2 text-[10px]"
                      onClick={() => setEditing(editing === proposal.id ? undefined : proposal.id)}
                    >
                      <Pencil size={13} /> Edit pending idea
                    </button>
                  ) : (
                    <Link
                      className="min-h-8 border border-navy bg-white px-2 text-[10px]"
                      href={`/community/proposals/${proposal.slug}`}
                    >
                      View public proposal
                    </Link>
                  )}
                </span>
                {editing === proposal.id ? (
                  <form
                    className="col-span-full grid grid-cols-1 gap-2 bg-blue-soft p-3"
                    onSubmit={(event) => void save(event, proposal.id)}
                    onInvalid={validation.onInvalid}
                    onInput={validation.onInput}
                  >
                    <input
                      {...validation.fieldProps('title')}
                      className={textInputClass}
                      name="title"
                      defaultValue={proposal.title}
                      minLength={4}
                      maxLength={120}
                      required
                    />
                    <FormFieldError {...validation.errorProps('title')} />
                    <input
                      {...validation.fieldProps('category')}
                      className={textInputClass}
                      name="category"
                      defaultValue={proposal.category}
                      maxLength={60}
                      required
                    />
                    <FormFieldError {...validation.errorProps('category')} />
                    <textarea
                      {...validation.fieldProps('description')}
                      className={textareaClass}
                      name="description"
                      defaultValue={proposal.description}
                      minLength={20}
                      maxLength={5000}
                      required
                    />
                    <FormFieldError {...validation.errorProps('description')} />
                    <button className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded border border-navy bg-navy px-3 font-bold text-white hover:border-blue hover:bg-blue hover:text-navy">
                      Save changes
                    </button>
                  </form>
                ) : null}
              </article>
            ))
          ) : (
            <div className="border-y border-line py-7">
              <span className="hidden">00</span>
              <h2 className="m-0 text-lg">No submissions yet.</h2>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
