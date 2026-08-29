'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, UnlockKeyhole, X } from 'lucide-react';
import { FORUM_CATEGORIES, type ForumConfig, type ForumTopicSummary } from '@precommunity/shared';
import { clientApiJson, clientApiRequest } from '@/lib/http';
import { forumTopicTitle } from '@/lib/format';
import { ActionButton } from './action-button';
import { ConfirmationDialog } from './confirmation-dialog';
import { StatusNotice, type StatusNoticeState } from './status-notice';

interface ForumWorkspace {
  config: ForumConfig;
  topics: ForumTopicSummary[];
}

export function ForumModerationPanel() {
  const [workspace, setWorkspace] = useState<ForumWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<StatusNoticeState | null>(null);
  const [topicToRemove, setTopicToRemove] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setWorkspace(
        await clientApiJson<ForumWorkspace>(
          '/v1/community/admin/forum',
          undefined,
          'Forum moderation',
        ),
      );
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Forum moderation could not be loaded.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle() {
    if (!workspace) return;
    setPending(true);
    setNotice(null);
    try {
      await clientApiRequest(
        '/v1/community/admin/forum/settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            topicModerationEnabled: !workspace.config.topicModerationEnabled,
          }),
        },
        'Forum setting',
      );
      setNotice({
        type: 'success',
        message: `Topic pre-moderation ${workspace.config.topicModerationEnabled ? 'disabled' : 'enabled'}.`,
      });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Forum setting could not be changed.',
      });
    } finally {
      setPending(false);
    }
  }

  async function moderate(
    id: string,
    action: 'approve' | 'decline' | 'lock' | 'unlock' | 'remove',
  ) {
    setPending(true);
    setNotice(null);
    try {
      await clientApiRequest(
        `/v1/community/admin/forum/topics/${id}/${action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
        'Topic moderation',
      );
      setNotice({ type: 'success', message: `Topic ${action} action completed.` });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Topic moderation failed.',
      });
    } finally {
      setPending(false);
    }
  }

  async function confirmRemove() {
    if (!topicToRemove) return;
    await moderate(topicToRemove, 'remove');
    setTopicToRemove(null);
  }

  return (
    <section className="mb-[34px] pb-7">
      <header className="mb-4 flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-stretch">
        <div>
          <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Forum controls
          </span>
          <h2 className="my-1 text-[25px]">Discussion moderation</h2>
          <p className="m-0 text-muted">
            Review new topics when needed and manage active discussions.
          </p>
        </div>
        <span className="flex gap-2 max-sm:grid max-sm:grid-cols-1">
          <ActionButton
            size="compact"
            icon={<RefreshCw size={14} />}
            className="px-3 text-[11px] font-bold"
            onClick={() => void load()}
          >
            Refresh
          </ActionButton>
          <button
            className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-navy px-2.5 text-[10px] font-bold transition-colors duration-150 hover:border-blue hover:bg-blue-soft ${workspace?.config.topicModerationEnabled ? 'bg-navy text-white hover:text-navy dark:hover:text-white' : 'bg-white'}`}
            role="switch"
            aria-checked={workspace?.config.topicModerationEnabled ?? false}
            disabled={!workspace || pending}
            onClick={() => void toggle()}
          >
            <i
              className={`size-2 rounded-full ${workspace?.config.topicModerationEnabled ? 'bg-success' : 'bg-muted'}`}
            />
            <span>
              {workspace?.config.topicModerationEnabled ? 'Topic review on' : 'Topic review off'}
            </span>
          </button>
        </span>
      </header>
      <StatusNotice notice={notice} />
      {!workspace ? (
        loading ? (
          <div className="flex items-center gap-2 py-5 text-muted">
            <LoaderCircle className="animate-spin" size={18} /> Loading forum controls…
          </div>
        ) : (
          <div className="flex items-center gap-2 py-5 text-muted">
            Forum controls are unavailable. Use Refresh to try again.
          </div>
        )
      ) : (
        <div className="border-t border-line">
          {workspace.topics.length ? (
            workspace.topics.map((topic) => (
              <article
                className="group grid min-h-16 grid-cols-[90px_minmax(200px,1fr)_auto] items-start gap-3 border-b border-line py-3 max-[900px]:grid-cols-[90px_minmax(180px,1fr)_auto] max-sm:grid-cols-1 max-sm:py-2.5"
                key={topic.id}
              >
                <span className="font-mono text-[8px] uppercase transition-transform duration-180 group-hover:translate-x-1">
                  {topic.status.replaceAll('_', ' ')}
                </span>
                <Link
                  className="-mx-2 -my-1 flex flex-col rounded-md px-2 py-1 transition-transform duration-180 group-hover:translate-x-1"
                  href={`/community/forum/${topic.slug}`}
                >
                  <small className="text-muted">
                    {FORUM_CATEGORIES.find((item) => item.value === topic.category)?.label} ·{' '}
                    {topic.replyCount} responses
                  </small>
                  <strong>{forumTopicTitle(topic.title, topic.state)}</strong>
                </Link>
                <span className="flex gap-[7px] max-[900px]:col-span-2 max-sm:col-auto max-sm:flex-wrap">
                  {topic.status === 'PENDING_REVIEW' ? (
                    <>
                      <ActionButton
                        size="compact"
                        icon={<ShieldCheck size={13} />}
                        onClick={() => void moderate(topic.id, 'approve')}
                        disabled={pending}
                      >
                        Approve
                      </ActionButton>
                      <ActionButton
                        size="compact"
                        icon={<X size={13} />}
                        onClick={() => void moderate(topic.id, 'decline')}
                        disabled={pending}
                      >
                        Decline
                      </ActionButton>
                    </>
                  ) : null}
                  {topic.status === 'PUBLISHED' ? (
                    <ActionButton
                      size="compact"
                      icon={<LockKeyhole size={13} />}
                      onClick={() => void moderate(topic.id, 'lock')}
                      disabled={pending}
                    >
                      Lock
                    </ActionButton>
                  ) : null}
                  {topic.status === 'LOCKED' && topic.state === 'ACTIVE' ? (
                    <ActionButton
                      size="compact"
                      icon={<UnlockKeyhole size={13} />}
                      onClick={() => void moderate(topic.id, 'unlock')}
                      disabled={pending}
                    >
                      Unlock
                    </ActionButton>
                  ) : null}
                  {topic.state === 'ACTIVE' ? (
                    <ActionButton
                      variant="danger"
                      size="compact"
                      onClick={() => setTopicToRemove(topic.id)}
                      disabled={pending}
                    >
                      Remove
                    </ActionButton>
                  ) : null}
                </span>
              </article>
            ))
          ) : (
            <p className="m-0 border-y border-line py-6 text-muted">No forum topics to moderate.</p>
          )}
        </div>
      )}
      <ConfirmationDialog
        open={Boolean(topicToRemove)}
        title="Remove topic?"
        description="This topic will no longer be visible in the forum."
        confirmLabel="Remove topic"
        pending={pending}
        onCancel={() => setTopicToRemove(null)}
        onConfirm={() => void confirmRemove()}
      />
    </section>
  );
}
