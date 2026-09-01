'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LoaderCircle, LockKeyhole, Pencil, Trash2, UserRound } from 'lucide-react';
import { type ForumConfig, type ForumTopicDetail } from '@precommunity/shared';
import { clientApiJson, clientApiRequest } from '@/lib/http';
import { useForumReplies } from '@/hooks/use-forum-replies';
import { formatUtcTimestamp, forumTopicTitle } from '@/lib/format';
import { ActionButton } from './action-button';
import { ConfirmationDialog } from './confirmation-dialog';
import { FormFieldError, useFormValidation } from './form-validation';
import { ForumReplyComposer } from './forum-reply-composer';
import { ForumReplyList } from './forum-reply-list';
import { ForumMarkdown, ForumMarkdownEditor } from './forum-markdown';
import { ShareLinks } from './share-links';
import { StatusNotice, type StatusNoticeState } from './status-notice';
import { FORUM_NOTIFICATIONS_CHANGED_EVENT } from '@/lib/auth-events';

export function ForumTopicWorkspace({
  topic,
  config,
}: {
  topic: ForumTopicDetail;
  config: ForumConfig;
}) {
  const router = useRouter();
  const [sessionAddress, setSessionAddress] = useState('');
  const [sessionRoles, setSessionRoles] = useState<string[]>([]);
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replyingTo, setReplyingTo] = useState<(typeof topic.replies)[number] | null>(null);
  const validation = useFormValidation();
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  const reportReplyError = useCallback((message: string) => {
    setNotice({ type: 'error', message });
  }, []);
  const { loadingEarlier, loadEarlier, nextCursor, replies } = useForumReplies(
    topic,
    reportReplyError,
  );
  const isAuthor = sessionAddress.toLowerCase() === topic.author.address.toLowerCase();
  const canModerate =
    sessionRoles.includes('SUPER_ADMIN') || sessionRoles.includes('CONTENT_ADMIN');
  const open = topic.status === 'PUBLISHED' && topic.state === 'ACTIVE';
  const canEditTopic =
    topic.state === 'ACTIVE' &&
    ((isAuthor && topic.status === 'PUBLISHED') ||
      (canModerate && (topic.status === 'PUBLISHED' || topic.status === 'LOCKED')));
  const canEditRepliesAsModerator =
    canModerate &&
    topic.state === 'ACTIVE' &&
    (topic.status === 'PUBLISHED' || topic.status === 'LOCKED');
  const category =
    config.categories.find((item) => item.value === topic.category)?.label ?? topic.category;

  useEffect(() => {
    clientApiJson<{ address: string; roles?: string[] }>('/v1/auth/me', undefined, 'Session API')
      .then((session) => {
        setSessionAddress(session.address);
        setSessionRoles(session.roles ?? []);
      })
      .catch(() => undefined);
  }, []);

  async function mutate(url: string, init: RequestInit, success: string) {
    setPending(true);
    setNotice(null);
    try {
      await clientApiRequest(
        url,
        { ...init, headers: { 'content-type': 'application/json', ...init.headers } },
        'Forum action',
      );
      setNotice({ type: 'success', message: success });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'The forum action could not be completed.',
      });
      return false;
    } finally {
      setPending(false);
    }
  }

  async function addReply(body: string, parentReplyId?: string) {
    const posted = await mutate(
      `/v1/community/forum/topics/${topic.id}/replies`,
      { method: 'POST', body: JSON.stringify({ body, parentReplyId }) },
      'Your response was posted.',
    );
    if (posted) {
      setReplyingTo(null);
      window.dispatchEvent(new Event(FORUM_NOTIFICATIONS_CHANGED_EVENT));
    }
    return posted;
  }

  async function saveTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ok = await mutate(
      `/v1/community/forum/topics/${topic.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          title: data.get('title'),
          body: data.get('body'),
          category: data.get('category'),
        }),
      },
      'Topic updated.',
    );
    if (ok) setEditing(false);
  }

  async function deleteTopic() {
    if (
      await mutate(`/v1/community/forum/topics/${topic.id}`, { method: 'DELETE' }, 'Topic deleted.')
    )
      router.push('/community/forum/mine');
  }

  async function editReply(id: string, body: string) {
    return mutate(
      `/v1/community/forum/replies/${id}`,
      { method: 'PUT', body: JSON.stringify({ body }) },
      'Response updated.',
    );
  }

  async function deleteReply(id: string) {
    await mutate(`/v1/community/forum/replies/${id}`, { method: 'DELETE' }, 'Response deleted.');
  }

  async function removeReplyAsModerator(id: string) {
    await mutate(
      `/v1/community/admin/forum/replies/${id}/remove`,
      { method: 'POST', body: '{}' },
      'Response removed by moderator.',
    );
  }

  async function confirmAction() {
    if (!confirmation) return;
    await confirmation.action();
    setConfirmation(null);
  }

  return (
    <main className="min-h-[70vh] px-[var(--page-pad)] pt-7 pb-[70px] max-sm:px-4 max-sm:pt-6 max-sm:pb-[50px]">
      <Link href="/community/forum" className="inline-flex items-center gap-1.5 text-xs text-blue">
        <ArrowLeft size={16} /> Back to forum
      </Link>
      <section className="border-b border-line pt-8 pb-7.5">
        <div>
          <div className="flex gap-1.5 font-mono text-[10px] text-blue uppercase">
            <span>{category}</span>
            <span>·</span>
            <strong>{topic.status.replaceAll('_', ' ')}</strong>
          </div>
          {editing ? (
            <form
              className="mt-3.5 grid gap-2"
              onSubmit={saveTopic}
              onInvalid={validation.onInvalid}
              onInput={validation.onInput}
            >
              <input
                {...validation.fieldProps('title')}
                className="min-h-10 w-full rounded-[3px] border border-line bg-white px-2.5 py-2 text-navy"
                name="title"
                defaultValue={topic.title ?? ''}
                minLength={4}
                maxLength={120}
                required
              />
              <FormFieldError {...validation.errorProps('title')} />
              <select
                className="min-h-10 w-full rounded-[3px] border border-line bg-white px-2.5 py-2 text-navy"
                name="category"
                defaultValue={topic.category}
              >
                {config.categories
                  .filter((item) => !item.archived || item.value === topic.category)
                  .map((item) => (
                    <option value={item.value} key={item.value}>
                      {item.label}
                      {item.archived ? ' · archived' : ''}
                    </option>
                  ))}
              </select>
              <ForumMarkdownEditor
                {...validation.fieldProps('body')}
                name="body"
                defaultValue={topic.body ?? ''}
                minLength={10}
                maxLength={5000}
                required
              />
              <FormFieldError {...validation.errorProps('body')} />
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
              <h1 className="mt-[11px] mb-2 text-[clamp(34px,5vw,54px)] leading-[1.02] tracking-[-.048em] max-sm:text-4xl">
                {forumTopicTitle(topic.title, topic.state)}
              </h1>
              <div className="max-w-[790px] text-[15px] text-muted">
                {topic.body ? (
                  <ForumMarkdown>{topic.body}</ForumMarkdown>
                ) : (
                  'The opening post is no longer available.'
                )}
              </div>
            </>
          )}
          <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
            <div className="grid size-7 place-items-center overflow-hidden rounded-full bg-blue-soft">
              {topic.author.avatarUrl ? (
                <img className="size-full object-cover" src={topic.author.avatarUrl} alt="" />
              ) : (
                <UserRound size={18} />
              )}
            </div>
            <span>
              Started by{' '}
              <Link href={`/community/profiles/${topic.author.address}`}>
                {topic.author.displayName ||
                  `${topic.author.address.slice(0, 6)}…${topic.author.address.slice(-4)}`}
              </Link>{' '}
              · {formatUtcTimestamp(topic.createdAt)}
            </span>
            {canEditTopic && !editing ? (
              <button
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-blue transition-transform duration-150 hover:translate-x-0.5"
                onClick={() => setEditing(true)}
              >
                <Pencil size={13} /> Edit
              </button>
            ) : null}
            {isAuthor && open && !editing ? (
              <button
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-danger transition-transform duration-150 hover:translate-x-0.5"
                onClick={() =>
                  setConfirmation({
                    title: 'Delete opening post?',
                    description:
                      'The opening post will be removed. Existing responses will remain in a locked thread.',
                    confirmLabel: 'Delete post',
                    action: deleteTopic,
                  })
                }
              >
                <Trash2 size={13} /> Delete
              </button>
            ) : null}
          </div>
          <ShareLinks kind="forum topic" title={forumTopicTitle(topic.title, topic.state)} />
        </div>
      </section>

      <StatusNotice notice={notice} />

      <section className="max-w-[920px] pt-10">
        {nextCursor ? (
          <ActionButton
            className="mb-3 min-h-[38px] w-full border-line text-[11px] text-navy hover:border-navy"
            icon={loadingEarlier ? <LoaderCircle className="animate-spin" size={15} /> : null}
            onClick={() => void loadEarlier()}
            disabled={loadingEarlier}
          >
            {loadingEarlier ? 'Loading…' : 'Load earlier responses'}
          </ActionButton>
        ) : null}
        <ForumReplyList
          replies={replies}
          totalCount={topic.replyCount}
          open={open}
          sessionAddress={sessionAddress}
          canModerate={canModerate}
          canEditAsModerator={canEditRepliesAsModerator}
          onReply={setReplyingTo}
          onEdit={(reply, body) => editReply(reply.id, body)}
          onDelete={(reply) =>
            setConfirmation({
              title: 'Delete response?',
              description: 'This response will no longer be visible in the discussion.',
              confirmLabel: 'Delete response',
              action: () => deleteReply(reply.id),
            })
          }
          onRemove={(reply) =>
            setConfirmation({
              title: 'Remove response?',
              description:
                'This response will be removed from the discussion and marked as moderated.',
              confirmLabel: 'Remove response',
              action: () => removeReplyAsModerator(reply.id),
            })
          }
        />
        {open ? (
          <ForumReplyComposer
            replyingTo={replyingTo}
            pending={pending}
            onCancelReply={() => setReplyingTo(null)}
            onSubmit={addReply}
            minimumPre={config.minimumPre.amount}
          />
        ) : (
          <div className="my-5 flex items-center gap-2 border-y border-line py-[13px] text-muted">
            <LockKeyhole size={16} />
            <span>This discussion is locked and no longer accepts responses.</span>
          </div>
        )}
      </section>
      <ConfirmationDialog
        open={Boolean(confirmation)}
        title={confirmation?.title ?? ''}
        description={confirmation?.description ?? ''}
        confirmLabel={confirmation?.confirmLabel ?? 'Confirm'}
        pending={pending}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmAction()}
      />
    </main>
  );
}
