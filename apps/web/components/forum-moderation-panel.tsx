'use client';

import { type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  UnlockKeyhole,
  X,
} from 'lucide-react';
import { type ForumConfig, type ForumTopicSummary } from '@precommunity/shared';
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
  const [minimumPre, setMinimumPre] = useState('');
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const next = await clientApiJson<ForumWorkspace>(
        '/v1/community/admin/forum',
        undefined,
        'Forum moderation',
      );
      setWorkspace(next);
      setMinimumPre(next.config.minimumPre.amount);
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Forum moderation could not be loaded.',
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveMinimum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      await clientApiRequest(
        '/v1/community/admin/forum/settings/minimum-pre',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ amount: minimumPre }),
        },
        'Forum PRE minimum',
      );
      setNotice({ type: 'success', message: `Forum writing now requires ${minimumPre} PRE.` });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'The PRE minimum could not be changed.',
      });
    } finally {
      setPending(false);
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

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get('label') ?? '');
    setPending(true);
    setNotice(null);
    try {
      await clientApiRequest(
        '/v1/community/admin/forum/categories',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label }),
        },
        'Forum category',
      );
      form.reset();
      setShowCategoryForm(false);
      setNotice({ type: 'success', message: `Category “${label.trim()}” created.` });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'The category could not be created.',
      });
    } finally {
      setPending(false);
    }
  }

  async function updateCategory(
    value: string,
    update: { label?: string; archived?: boolean },
    success: string,
  ) {
    setPending(true);
    setNotice(null);
    try {
      await clientApiRequest(
        `/v1/community/admin/forum/categories/${encodeURIComponent(value)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(update),
        },
        'Forum category',
      );
      setEditingCategory(null);
      setNotice({ type: 'success', message: success });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'The category could not be updated.',
      });
    } finally {
      setPending(false);
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>, value: string) {
    event.preventDefault();
    const label = String(new FormData(event.currentTarget).get('label') ?? '');
    await updateCategory(value, { label }, `Category renamed to “${label.trim()}”.`);
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

  const activeCategoryCount =
    workspace?.config.categories.filter((category) => !category.archived).length ?? 0;

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
        <>
          <form
            className="mb-5 grid grid-cols-[minmax(180px,280px)_auto_minmax(220px,1fr)] items-end gap-3 border-y border-line bg-blue-soft px-3 py-3 max-sm:grid-cols-1"
            onSubmit={(event) => void saveMinimum(event)}
          >
            <label className="grid gap-1.5">
              <span className="text-[10px] font-bold text-muted uppercase">
                Minimum PRE to write
              </span>
              <input
                className="h-10 rounded-[3px] border border-line bg-white px-2.5 text-navy"
                name="amount"
                value={minimumPre}
                inputMode="decimal"
                pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?"
                maxLength={79}
                required
                onChange={(event) => setMinimumPre(event.currentTarget.value)}
              />
            </label>
            <ActionButton variant="primary" disabled={pending}>
              Save minimum
            </ActionButton>
            <p className="m-0 text-[10px] text-muted">
              Applies to publishing and editing topics and responses. Set 0 to allow any signed-in
              wallet to write.
            </p>
          </form>
          <section className="mb-5 border-t border-line" aria-labelledby="forum-categories-title">
            <header className="flex items-center justify-between gap-4 border-b border-line py-3 max-sm:items-start">
              <div>
                <h3 className="m-0 text-[17px]" id="forum-categories-title">
                  Forum categories
                </h3>
                <p className="mt-1 mb-0 text-[10px] text-muted">
                  Archived categories stay visible in existing discussions but cannot receive new
                  topics.
                </p>
              </div>
              <ActionButton
                type="button"
                size="compact"
                icon={showCategoryForm ? <X size={13} /> : <Plus size={13} />}
                onClick={() => setShowCategoryForm((value) => !value)}
                disabled={pending}
              >
                {showCategoryForm ? 'Cancel' : 'Add category'}
              </ActionButton>
            </header>
            {showCategoryForm ? (
              <form
                className="grid grid-cols-[minmax(180px,320px)_auto_1fr] items-end gap-3 border-b border-line bg-blue-soft px-3 py-3 max-sm:grid-cols-1"
                onSubmit={(event) => void createCategory(event)}
              >
                <label className="grid gap-1.5">
                  <span className="text-[10px] font-bold text-muted uppercase">Category name</span>
                  <input
                    className="h-10 rounded-[3px] border border-line bg-white px-2.5 text-navy"
                    name="label"
                    maxLength={80}
                    required
                    autoFocus
                  />
                </label>
                <ActionButton variant="primary" disabled={pending}>
                  Create category
                </ActionButton>
                <p className="m-0 text-[10px] text-muted">
                  The stable identifier is generated once from this name.
                </p>
              </form>
            ) : null}
            <div>
              {workspace.config.categories.length ? (
                workspace.config.categories.map((category) =>
                  editingCategory === category.value ? (
                    <form
                      className="grid grid-cols-[minmax(180px,320px)_auto_auto_1fr] items-end gap-2 border-b border-line bg-blue-soft px-3 py-3 max-sm:grid-cols-1"
                      key={category.value}
                      onSubmit={(event) => void saveCategory(event, category.value)}
                    >
                      <label className="grid gap-1.5">
                        <span className="text-[10px] font-bold text-muted uppercase">
                          Category name
                        </span>
                        <input
                          className="h-10 rounded-[3px] border border-line bg-white px-2.5 text-navy"
                          name="label"
                          defaultValue={category.label}
                          maxLength={80}
                          required
                          autoFocus
                        />
                      </label>
                      <ActionButton variant="primary" disabled={pending}>
                        Save
                      </ActionButton>
                      <ActionButton
                        type="button"
                        disabled={pending}
                        onClick={() => setEditingCategory(null)}
                      >
                        Cancel
                      </ActionButton>
                      <small className="self-center font-mono text-[9px] text-muted">
                        {category.value}
                      </small>
                    </form>
                  ) : (
                    <article
                      className="group grid min-h-14 grid-cols-[minmax(180px,1fr)_90px_auto] items-center gap-3 border-b border-line py-2.5 max-sm:grid-cols-1"
                      key={category.value}
                    >
                      <span className="flex min-w-0 flex-col transition-transform duration-180 group-hover:translate-x-1">
                        <strong>{category.label}</strong>
                        <small className="font-mono text-[9px] text-muted">{category.value}</small>
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-mono text-[8px] uppercase">
                        <i
                          className={`size-2 rounded-full ${category.archived ? 'bg-muted' : 'bg-success'}`}
                        />
                        {category.archived ? 'Archived' : 'Active'}
                      </span>
                      <span className="flex justify-end gap-1.5 max-sm:justify-start">
                        <ActionButton
                          type="button"
                          size="compact"
                          icon={<Pencil size={13} />}
                          onClick={() => setEditingCategory(category.value)}
                          disabled={pending}
                        >
                          Edit
                        </ActionButton>
                        <ActionButton
                          type="button"
                          size="compact"
                          onClick={() =>
                            void updateCategory(
                              category.value,
                              { archived: !category.archived },
                              category.archived
                                ? `Category “${category.label}” restored.`
                                : `Category “${category.label}” archived.`,
                            )
                          }
                          disabled={pending || (!category.archived && activeCategoryCount <= 1)}
                          title={
                            !category.archived && activeCategoryCount <= 1
                              ? 'At least one category must remain active.'
                              : undefined
                          }
                        >
                          {category.archived ? 'Restore' : 'Archive'}
                        </ActionButton>
                      </span>
                    </article>
                  ),
                )
              ) : (
                <p className="m-0 border-b border-line py-5 text-muted">
                  No forum categories configured.
                </p>
              )}
            </div>
          </section>
          <header className="flex items-end justify-between gap-4 pb-2">
            <h3 className="m-0 text-[17px]">Topics to moderate</h3>
            <small className="text-muted">Up to 100 active discussions</small>
          </header>
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
                      {workspace.config.categories.find((item) => item.value === topic.category)
                        ?.label ?? topic.category}{' '}
                      · {topic.replyCount} responses
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
              <p className="m-0 border-y border-line py-6 text-muted">
                No forum topics to moderate.
              </p>
            )}
          </div>
        </>
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
