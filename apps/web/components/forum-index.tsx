'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, LoaderCircle, MessageSquareText, Plus, X } from 'lucide-react';
import {
  FORUM_CATEGORIES,
  type ForumCategory,
  type ForumConfig,
  type ForumTopicDetail,
  type ForumTopicsPage,
} from '@precommunity/shared';
import { ApiError, clientApiJson } from '@/lib/http';
import { formatUtcTimestamp, forumTopicTitle } from '@/lib/format';
import { ActionButton } from './action-button';
import { FormFieldError, useFormValidation } from './form-validation';
import { ForumMarkdownEditor } from './forum-markdown';
import { StatusNotice } from './status-notice';

function categoryLabel(category: ForumCategory) {
  return FORUM_CATEGORIES.find((item) => item.value === category)?.label ?? category;
}

export function ForumIndex({
  initialPage,
  config,
  activeCategory,
}: {
  initialPage: ForumTopicsPage;
  config: ForumConfig;
  activeCategory?: ForumCategory;
}) {
  const router = useRouter();
  const [topics, setTopics] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [formOpen, setFormOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const validation = useFormValidation();

  async function createTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const saveDraft = submitter?.value === 'draft';
    setPending(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const topic = await clientApiJson<ForumTopicDetail>(
        saveDraft ? '/v1/community/forum/topics/drafts' : '/v1/community/forum/topics',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: data.get('title'),
            body: data.get('body'),
            category: data.get('category'),
          }),
        },
        saveDraft ? 'Draft save' : 'Topic publication',
      );
      if (topic.status === 'DRAFT') router.push('/community/forum/mine?submitted=draft');
      else if (topic.status === 'PENDING_REVIEW')
        router.push('/community/forum/mine?submitted=pending');
      else router.push(`/community/forum/${topic.slug}`);
      router.refresh();
    } catch (error) {
      setError(
        error instanceof ApiError && error.status === 401
          ? 'Connect and sign in with your wallet first.'
          : error instanceof Error
            ? error.message
            : saveDraft
              ? 'The draft could not be saved.'
              : 'The topic could not be published.',
      );
    } finally {
      setPending(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError('');
    const params = new URLSearchParams({ cursor: nextCursor, limit: '20' });
    if (activeCategory) params.set('category', activeCategory);
    try {
      const page = await clientApiJson<ForumTopicsPage>(
        `/v1/community/forum/topics?${params}`,
        undefined,
        'More topics',
      );
      setTopics((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'More topics could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="min-h-[70vh]">
      <section className="grid grid-cols-[minmax(0,1fr)_260px] gap-10 border-b border-line px-[var(--page-pad)] pt-12 pb-[34px] max-sm:grid-cols-1 max-sm:gap-6 max-sm:px-4 max-sm:pt-9 max-sm:pb-[26px]">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[.05em] text-blue uppercase">
            Community forum · public to read
          </span>
          <h1 className="mt-[13px] mb-2 text-[clamp(40px,5vw,60px)] leading-none tracking-[-.05em]">
            Talk it through.
          </h1>
          <p className="m-0 max-w-[690px] text-[15px] text-muted">
            Ask questions, share context and develop an idea before it becomes a formal proposal.
          </p>
        </div>
        <aside className="self-end border-l border-line pl-6 max-sm:border-t max-sm:border-l-0 max-sm:px-0 max-sm:pt-4">
          <strong className="block font-mono text-[38px]">
            {topics.length.toString().padStart(2, '0')}
          </strong>
          <span className="font-bold">active topics loaded</span>
          <small className="mt-1 block text-muted">
            Posting requires a signed-in wallet with at least {config.minimumPre.amount} PRE.
          </small>
        </aside>
      </section>

      <section className="flex justify-between gap-6 border-b border-line bg-white px-[var(--page-pad)] py-3.5 max-sm:flex-col max-sm:px-4">
        <div className="flex flex-col">
          <strong>Latest discussions</strong>
          <small className="text-muted">Ordered by the most recent response.</small>
        </div>
        <span className="flex gap-2 max-sm:grid max-sm:grid-cols-2">
          <Link
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded border border-navy bg-white px-3 font-bold hover:bg-blue-soft"
            href="/community/forum/mine"
          >
            Your topics
          </Link>
          <ActionButton
            variant="primary"
            icon={formOpen ? <X size={17} /> : <Plus size={17} />}
            onClick={() => setFormOpen((value) => !value)}
          >
            {formOpen ? 'Close' : 'Start a topic'}
          </ActionButton>
        </span>
      </section>

      {formOpen ? (
        <form
          className="grid grid-cols-[1fr_280px] gap-3 border-b border-line bg-blue-soft px-[var(--page-pad)] py-[26px] max-sm:grid-cols-1 max-sm:px-4 max-sm:py-[22px]"
          onSubmit={createTopic}
          onInvalid={validation.onInvalid}
          onInput={validation.onInput}
        >
          <header className="col-span-full max-sm:col-auto">
            <div>
              <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
                New discussion
              </span>
              <h2 className="mt-1 mb-2 text-[25px]">Start with a clear question or point.</h2>
            </div>
          </header>
          <label className="grid gap-1.5">
            <span className="text-[10px] text-muted">Title</span>
            <input
              {...validation.fieldProps('title')}
              className="min-h-10 w-full rounded-[3px] border border-line bg-white px-2.5 py-2 text-navy"
              name="title"
              minLength={4}
              maxLength={120}
              required
              placeholder="What should the community discuss?"
            />
            <FormFieldError {...validation.errorProps('title')} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[10px] text-muted">Category</span>
            <select
              {...validation.fieldProps('category')}
              className="min-h-10 w-full rounded-[3px] border border-line bg-white px-2.5 py-2 text-navy"
              name="category"
              required
              defaultValue="GENERAL"
            >
              {FORUM_CATEGORIES.map((category) => (
                <option value={category.value} key={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
            <FormFieldError {...validation.errorProps('category')} />
          </label>
          <div className="col-span-full grid gap-1.5 max-sm:col-auto">
            <label className="text-[10px] text-muted" htmlFor="new-topic-body">
              Opening post
            </label>
            <ForumMarkdownEditor
              {...validation.fieldProps('body')}
              id="new-topic-body"
              name="body"
              minLength={10}
              maxLength={5000}
              required
              placeholder="Add the context others need to respond."
            />
            <FormFieldError {...validation.errorProps('body')} />
          </div>
          <div className="col-span-full flex items-center justify-between gap-5 max-sm:col-auto max-sm:items-stretch max-sm:flex-col">
            <p className="max-w-[440px] text-[11px] text-muted">
              {config.topicModerationEnabled
                ? 'New topics are reviewed before they appear publicly.'
                : 'Your topic will appear immediately. Keep it useful and specific.'}
            </p>
            <span className="flex gap-2 max-sm:grid max-sm:grid-cols-2">
              <ActionButton
                type="submit"
                name="intent"
                value="draft"
                formNoValidate
                disabled={pending}
              >
                Save draft
              </ActionButton>
              <ActionButton
                type="submit"
                name="intent"
                value="publish"
                variant="primary"
                icon={
                  pending ? (
                    <LoaderCircle className="animate-spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )
                }
                disabled={pending}
              >
                {pending
                  ? 'Checking PRE…'
                  : config.topicModerationEnabled
                    ? 'Submit for review'
                    : 'Publish topic'}
              </ActionButton>
            </span>
          </div>
          <div className="col-span-full max-sm:col-auto">
            <StatusNotice notice={error ? { type: 'error', message: error } : null} />
          </div>
        </form>
      ) : null}

      <nav
        className="flex gap-1.5 overflow-x-auto border-b border-line px-[var(--page-pad)] py-2 max-sm:px-4"
        aria-label="Forum categories"
      >
        <Link
          className={`shrink-0 px-2 py-1.5 text-[9px] font-bold text-muted uppercase hover:bg-navy hover:text-white ${!activeCategory ? 'bg-navy text-white' : ''}`}
          href="/community/forum"
        >
          All topics
        </Link>
        {FORUM_CATEGORIES.map((category) => (
          <Link
            className={`shrink-0 px-2 py-1.5 text-[9px] font-bold text-muted uppercase hover:bg-navy hover:text-white ${activeCategory === category.value ? 'bg-navy text-white' : ''}`}
            href={`/community/forum?category=${category.value}`}
            key={category.value}
          >
            {category.label}
          </Link>
        ))}
      </nav>

      <section className="px-[var(--page-pad)] pt-2.5 pb-7.5 max-sm:px-4" aria-label="Forum topics">
        <div
          className="grid grid-cols-[minmax(260px,1fr)_110px_170px] gap-4 border-b border-navy py-2 pr-[34px] pl-9 font-mono text-[9px] text-muted uppercase max-[900px]:hidden"
          aria-hidden="true"
        >
          <span>Topic</span>
          <span>Replies</span>
          <span>Activity</span>
        </div>
        {topics.length ? (
          topics.map((topic, index) => (
            <Link
              className="group grid min-h-[94px] grid-cols-[22px_minmax(260px,1fr)_110px_170px_18px] items-center gap-3.5 border-b border-line transition-[padding] duration-180 hover:px-2.5 max-[900px]:grid-cols-[22px_minmax(220px,1fr)_90px_18px] max-sm:min-h-[118px] max-sm:grid-cols-[20px_minmax(0,1fr)_18px] max-sm:items-start max-sm:py-3 motion-safe:[animation:row-rise_.45s_var(--row-delay)_cubic-bezier(.16,1,.3,1)_both]"
              href={`/community/forum/${topic.slug}`}
              key={topic.id}
              style={{ '--row-delay': `${Math.min(index, 10) * 45}ms` } as React.CSSProperties}
            >
              <span className="font-mono text-[9px] text-blue">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="flex min-w-0 flex-col">
                <small className="font-mono text-[9px] text-blue uppercase">
                  {categoryLabel(topic.category)}
                  {topic.status === 'LOCKED' ? ' · locked' : ''}
                </small>
                <strong className="my-1 text-[17px]">
                  {forumTopicTitle(topic.title, topic.state)}
                </strong>
                <span className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-muted">
                  {topic.excerpt ?? 'The opening post is no longer available.'}
                </span>
              </span>
              <span className="contents max-sm:hidden">
                <span className="inline-flex items-start gap-1.5 text-muted">
                  <MessageSquareText className="mt-0.5" size={15} />
                  <span className="flex flex-col">
                    <strong>{topic.replyCount}</strong>
                    <small className="text-[9px]">responses</small>
                  </span>
                </span>
                <time className="font-mono text-[9px] text-muted max-[900px]:col-start-2">
                  {formatUtcTimestamp(topic.lastActivityAt)}
                </time>
              </span>
              <span className="hidden max-sm:col-start-2 max-sm:row-start-2 max-sm:flex max-sm:w-full max-sm:items-center max-sm:justify-between">
                <span className="inline-flex items-start gap-1.5 text-muted">
                  <MessageSquareText className="mt-0.5" size={15} />
                  <span className="flex flex-col">
                    <strong>{topic.replyCount}</strong>
                    <small className="text-[9px]">responses</small>
                  </span>
                </span>
                <time className="font-mono text-[9px] text-muted">
                  {formatUtcTimestamp(topic.lastActivityAt)}
                </time>
              </span>
              <ArrowUpRight
                className="text-blue transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1 max-[900px]:col-start-4 max-[900px]:row-start-1 max-sm:col-start-3 max-sm:row-start-1"
                size={17}
              />
            </Link>
          ))
        ) : (
          <div className="border-y border-line py-7">
            <span className="hidden">00</span>
            <h2 className="m-0 text-lg">No forum topics yet.</h2>
            <p className="text-muted">Start the first discussion with the community.</p>
          </div>
        )}
      </section>
      {nextCursor ? (
        <ActionButton
          className="mx-[var(--page-pad)] mb-12 flex min-h-[42px] w-[calc(100%-2*var(--page-pad))] bg-transparent hover:bg-navy hover:text-white max-sm:mx-4 max-sm:w-[calc(100%-32px)]"
          icon={loadingMore ? <LoaderCircle className="animate-spin" size={16} /> : null}
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : 'Load more discussions'}
        </ActionButton>
      ) : null}
      {!formOpen ? (
        <StatusNotice notice={error ? { type: 'error', message: error } : null} />
      ) : null}
    </main>
  );
}
