'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Clock3,
  MessageSquareText,
  Pencil,
  ShieldCheck,
  Trash2,
  UserRound,
  Vote,
} from 'lucide-react';
import { formatUnits } from 'viem';
import type { CommunityProposal, ProposalVoteChoice } from '@precommunity/shared';
import { clientApiJson, clientApiRequest } from '@/lib/http';
import { ActionButton } from './action-button';
import { FormFieldError, useFormValidation } from './form-validation';
import { textInputClass, textareaClass } from './form-control-classes';
import { ShareLinks } from './share-links';
import { StatusNotice, type StatusNoticeState } from './status-notice';

function displayPre(raw: string) {
  const value = formatUnits(BigInt(raw), 18);
  const [whole, fraction] = value.split('.');
  return `${whole}${fraction && Number(fraction) ? `.${fraction.slice(0, 3).replace(/0+$/, '')}` : ''} PRE`;
}

function percentage(raw: string, total: bigint) {
  return total ? Number((BigInt(raw) * 10_000n) / total) / 100 : 0;
}

export function ProposalWorkspace({ proposal }: { proposal: CommunityProposal }) {
  const router = useRouter();
  const [sessionAddress, setSessionAddress] = useState('');
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<ProposalVoteChoice>();
  const validation = useFormValidation();
  const total = useMemo(
    () =>
      BigInt(proposal.results.forRaw) +
      BigInt(proposal.results.againstRaw) +
      BigInt(proposal.results.abstainRaw),
    [proposal.results],
  );
  const isAuthor = sessionAddress.toLowerCase() === proposal.author.address.toLowerCase();

  useEffect(() => {
    clientApiJson<{ address: string }>('/v1/auth/me', undefined, 'Session API')
      .then((session) => setSessionAddress(session.address))
      .catch(() => undefined);
  }, []);

  async function mutate(url: string, init: RequestInit, success: string) {
    setPending(true);
    setNotice(null);
    try {
      await clientApiRequest(
        url,
        { ...init, headers: { 'content-type': 'application/json', ...init.headers } },
        'Community action',
      );
      setNotice({ type: 'success', message: success });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'The action could not be completed.',
      });
      return false;
    } finally {
      setPending(false);
    }
  }

  async function vote(nextChoice: ProposalVoteChoice) {
    if (
      await mutate(
        `/v1/community/proposals/${proposal.id}/vote`,
        { method: 'PUT', body: JSON.stringify({ choice: nextChoice }) },
        'Your snapshot-weighted vote is recorded.',
      )
    )
      setChoice(nextChoice);
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    if (
      await mutate(
        `/v1/community/proposals/${proposal.id}/comments`,
        { method: 'POST', body: JSON.stringify({ body }) },
        'Comment posted.',
      )
    )
      form.reset();
  }

  async function saveProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ok = await mutate(
      `/v1/community/proposals/${proposal.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          title: data.get('title'),
          category: data.get('category'),
          description: data.get('description'),
        }),
      },
      'Proposal updated.',
    );
    if (ok) setEditing(false);
  }

  async function deleteComment(id: string) {
    await mutate(`/v1/community/comments/${id}`, { method: 'DELETE' }, 'Comment deleted.');
  }

  async function editComment(id: string, current: string) {
    const body = window.prompt('Edit your comment', current)?.trim();
    if (!body || body === current) return;
    await mutate(
      `/v1/community/comments/${id}`,
      { method: 'PUT', body: JSON.stringify({ body }) },
      'Comment updated.',
    );
  }

  return (
    <main className="min-h-[70vh] px-[var(--page-pad)] pt-7 pb-[60px]">
      <Link
        href="/community/proposals"
        className="inline-flex items-center gap-1.5 text-xs text-blue"
      >
        <ArrowLeft size={16} /> Back to proposals
      </Link>
      <section className="grid grid-cols-[minmax(0,1fr)_260px] items-end gap-10 border-b border-navy py-7 max-[900px]:grid-cols-1">
        <div>
          <div className="flex gap-1.5 font-mono text-[10px] text-blue uppercase">
            <span>{proposal.category}</span>
            <span>·</span>
            <strong>{proposal.status.replaceAll('_', ' ')}</strong>
          </div>
          {editing ? (
            <form
              className="mt-3.5 grid gap-2"
              onSubmit={saveProposal}
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
              <div className="flex justify-end gap-2">
                <ActionButton type="button" onClick={() => setEditing(false)}>
                  Cancel
                </ActionButton>
                <ActionButton variant="primary" disabled={pending}>
                  Save changes
                </ActionButton>
              </div>
            </form>
          ) : (
            <>
              <h1 className="mt-2.5 mb-2 text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-.04em]">
                {proposal.title}
              </h1>
              <p className="m-0 max-w-[760px] whitespace-pre-wrap text-muted">
                {proposal.description}
              </p>
            </>
          )}
          <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
            <div className="grid size-7 place-items-center overflow-hidden rounded-full bg-blue-soft">
              {proposal.author.avatarUrl ? (
                <img className="size-full object-cover" src={proposal.author.avatarUrl} alt="" />
              ) : (
                <UserRound size={18} />
              )}
            </div>
            <span>
              Proposed by{' '}
              <Link href={`/community/profiles/${proposal.author.address}`}>
                {proposal.author.displayName ||
                  `${proposal.author.address.slice(0, 6)}…${proposal.author.address.slice(-4)}`}
              </Link>
            </span>
            {isAuthor && proposal.status === 'PENDING_REVIEW' && !editing ? (
              <button
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-blue transition-transform duration-150 hover:translate-x-0.5"
                onClick={() => setEditing(true)}
              >
                <Pencil size={13} /> Edit
              </button>
            ) : null}
          </div>
          <ShareLinks kind="proposal" title={proposal.title} />
        </div>
        <aside className="border border-line bg-white p-[18px]">
          <span className="text-[10px] text-muted uppercase">Proposal process</span>
          <ol className="my-3 list-none p-0">
            <li className="flex items-center gap-1.5 border-b border-line py-[7px] text-[11px] text-navy">
              <Check size={14} /> Submitted
            </li>
            <li
              className={`flex items-center gap-1.5 border-b border-line py-[7px] text-[11px] ${proposal.status !== 'PENDING_REVIEW' ? 'text-navy' : 'text-blue'}`}
            >
              <ShieldCheck size={14} /> Content review
            </li>
            <li
              className={`flex items-center gap-1.5 border-b border-line py-[7px] text-[11px] ${proposal.status === 'REJECTED' ? 'text-danger' : ['VOTING', 'PASSED', 'CONVERTED'].includes(proposal.status) ? 'text-navy' : 'text-muted'}`}
            >
              <Vote size={14} /> Seven-day vote
            </li>
            <li
              className={`flex items-center gap-1.5 border-b border-line py-[7px] text-[11px] ${proposal.status === 'CONVERTED' ? 'text-navy' : 'text-muted'}`}
            >
              <Check size={14} /> Goal draft
            </li>
          </ol>
          {proposal.snapshotBlock ? (
            <small className="font-mono text-[9px] text-muted">
              Snapshot block {proposal.snapshotBlock}
            </small>
          ) : (
            <small className="font-mono text-[9px] text-muted">
              Snapshot is selected when voting opens.
            </small>
          )}
        </aside>
      </section>

      <StatusNotice notice={notice} />

      <section className="grid grid-cols-[minmax(0,1fr)_320px] gap-10 border-t border-line pt-9 max-[900px]:grid-cols-1">
        <div>
          <header className="flex justify-between">
            <div>
              <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
                Discussion
              </span>
              <h2 className="my-1 text-[22px]">{proposal.comments?.length ?? 0} responses</h2>
            </div>
            <MessageSquareText size={24} />
          </header>
          <form
            className="my-[18px] mb-1 border-y border-line"
            onSubmit={addComment}
            onInvalid={validation.onInvalid}
            onInput={validation.onInput}
          >
            <textarea
              {...validation.fieldProps('body')}
              className="min-h-24 w-full resize-y border-0 bg-transparent px-0 py-2 outline-none"
              name="body"
              minLength={2}
              maxLength={2000}
              required
              placeholder="Add context, ask a question, or challenge an assumption."
            />
            <FormFieldError {...validation.errorProps('body')} />
            <div className="flex items-center justify-between gap-4 border-t border-line py-2 max-sm:flex-col max-sm:items-stretch">
              <span className="text-[10px] text-muted">
                Requires a signed-in wallet with 1 PRE.
              </span>
              <ActionButton variant="primary" size="compact" disabled={pending}>
                Post comment
              </ActionButton>
            </div>
          </form>
          <div>
            {proposal.comments?.map((comment) => {
              const own = sessionAddress.toLowerCase() === comment.author.address.toLowerCase();
              return (
                <article className="border-b border-line py-3.5" key={comment.id}>
                  <div className="flex justify-between gap-4 text-[11px] max-sm:flex-col max-sm:gap-0.5">
                    <Link href={`/community/profiles/${comment.author.address}`}>
                      {comment.author.displayName ||
                        `${comment.author.address.slice(0, 6)}…${comment.author.address.slice(-4)}`}
                    </Link>
                    <time className="text-muted">
                      {new Intl.DateTimeFormat('en', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(comment.createdAt))}
                      {comment.editedAt ? ' · edited' : ''}
                    </time>
                  </div>
                  <p
                    className={`mb-0 whitespace-pre-wrap ${comment.state !== 'ACTIVE' ? 'text-muted' : ''}`}
                  >
                    {comment.body ??
                      (comment.state === 'REMOVED'
                        ? 'Removed by a moderator.'
                        : 'Deleted by the author.')}
                  </p>
                  {own && comment.state === 'ACTIVE' && comment.body ? (
                    <div className="mt-1.5 flex gap-2">
                      <button
                        className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-blue transition-transform duration-150 hover:translate-x-0.5"
                        onClick={() => void editComment(comment.id, comment.body!)}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-danger transition-transform duration-150 hover:translate-x-0.5"
                        onClick={() => void deleteComment(comment.id)}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <aside className="sticky top-[calc(var(--header-height)+16px)] self-start border border-line bg-white p-[18px] max-[900px]:static">
          <div>
            <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
              Off-chain vote weighted by PRE snapshot
            </span>
            <h2 className="my-1 text-[22px]">
              {proposal.status === 'VOTING' ? 'Voting is open.' : 'Current result.'}
            </h2>
            {proposal.votingEndsAt ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <Clock3 size={14} /> {proposal.status === 'VOTING' ? 'Ends' : 'Closed'}{' '}
                {new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(
                  new Date(proposal.votingEndsAt),
                )}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                Voting begins after content review.
              </p>
            )}
          </div>
          <div className="mt-[18px]">
            {(
              [
                ['FOR', proposal.results.forRaw, 'For'],
                ['AGAINST', proposal.results.againstRaw, 'Against'],
                ['ABSTAIN', proposal.results.abstainRaw, 'Abstain'],
              ] as const
            ).map(([key, raw, label]) => (
              <div className="my-3" key={key}>
                <div className="flex justify-between text-[11px]">
                  <strong>{label}</strong>
                  <span className="font-mono text-[9px]">{displayPre(raw)}</span>
                </div>
                <div className="my-1 h-1 overflow-hidden bg-line">
                  <i
                    className="block h-full bg-blue"
                    style={{ width: `${percentage(raw, total)}%` }}
                  />
                </div>
                <small className="text-[9px] text-muted">
                  {percentage(raw, total).toFixed(1)}%
                </small>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5 border-y border-line py-2.5">
            <span className="flex flex-col text-[9px] text-muted">
              <strong className="text-[11px] text-navy">{proposal.results.voterCount}</strong>{' '}
              wallets
            </span>
            <span className="flex flex-col text-[9px] text-muted">
              <strong className="text-[11px] text-navy">{displayPre(total.toString())}</strong>{' '}
              participating
            </span>
          </div>
          {proposal.status === 'VOTING' ? (
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {(['FOR', 'AGAINST', 'ABSTAIN'] as const).map((item) => (
                <ActionButton
                  key={item}
                  variant={item === 'FOR' ? 'primary' : item === 'AGAINST' ? 'danger' : 'secondary'}
                  size="compact"
                  className={item === 'FOR' ? 'col-span-full' : ''}
                  icon={choice === item ? <Check size={14} /> : null}
                  disabled={pending}
                  onClick={() => void vote(item)}
                >
                  {item === 'FOR' ? 'Vote for' : item === 'AGAINST' ? 'Vote against' : 'Abstain'}
                </ActionButton>
              ))}
            </div>
          ) : null}
          <p className="text-[9px] text-muted">
            Your vote is stored off-chain. Its weight is your PRE balance at the snapshot block;
            tokens acquired afterwards do not count.
          </p>
          {proposal.convertedExpense ? (
            <Link
              className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs text-success"
              href="/admin"
            >
              Goal draft created <Check size={14} />
            </Link>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
