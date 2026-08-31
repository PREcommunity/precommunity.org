'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CircleAlert, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import { FORUM_CATEGORIES, type ForumConfig, type ForumTopicDetail } from '@precommunity/shared';
import { ApiError, clientApiJson, clientApiRequest } from '@/lib/http';
import { forumTopicTitle } from '@/lib/format';
import { ActionButton } from './action-button';
import { ConfirmationDialog } from './confirmation-dialog';
import { FormFieldError, useFormValidation } from './form-validation';
import { selectClass, textInputClass } from './form-control-classes';
import { StatusNotice, type StatusNoticeState } from './status-notice';
import { ForumMarkdownEditor } from './forum-markdown';

export function ForumMine({ submitted, config }: { submitted?: string; config: ForumConfig }) {
  const [items, setItems] = useState<ForumTopicDetail[]>([]);
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<string>();
  const [notice, setNotice] = useState<StatusNoticeState | null>(
    submitted === 'pending'
      ? { type: 'success', message: 'Topic submitted for moderator review.' }
      : submitted === 'draft'
        ? { type: 'success', message: 'Draft saved to your account.' }
        : null,
  );
  const [topicToDelete, setTopicToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const validation = useFormValidation();

  async function load() {
    setState('loading');
    setLoadError('');
    try {
      setItems(
        await clientApiJson<ForumTopicDetail[]>(
          '/v1/community/forum/topics/mine',
          undefined,
          'Your topics',
        ),
      );
      setState('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState('signed-out');
        return;
      }
      setLoadError(error instanceof Error ? error.message : 'Your topics could not be loaded.');
      setState('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>, topic: ForumTopicDetail) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const publish = topic.status === 'DRAFT' && submitter?.value === 'publish';
    const data = new FormData(event.currentTarget);
    try {
      const updated = await clientApiJson<ForumTopicDetail>(
        publish
          ? `/v1/community/forum/topics/${topic.id}/publish`
          : topic.status === 'DRAFT'
            ? `/v1/community/forum/topics/${topic.id}/draft`
            : `/v1/community/forum/topics/${topic.id}`,
        {
          method: publish ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: data.get('title'),
            body: data.get('body'),
            category: data.get('category'),
          }),
        },
        publish ? 'Draft publication' : 'Topic update',
      );
      setNotice({
        type: 'success',
        message: publish
          ? updated.status === 'PENDING_REVIEW'
            ? 'Draft submitted for moderator review.'
            : 'Draft published.'
          : topic.status === 'DRAFT'
            ? 'Draft saved.'
            : 'Topic updated.',
      });
      setEditing(undefined);
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Topic could not be updated.',
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await clientApiRequest(
        `/v1/community/forum/topics/${id}`,
        { method: 'DELETE' },
        'Topic deletion',
      );
      setNotice({ type: 'success', message: 'Topic deleted.' });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Topic could not be deleted.',
      });
    }
  }

  async function confirmDelete() {
    if (!topicToDelete) return;
    setDeleting(true);
    try {
      await remove(topicToDelete);
      setTopicToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-[70vh] px-[var(--page-pad)] pt-7 pb-[60px]">
      <Link href="/community/forum" className="inline-flex items-center gap-1.5 text-xs text-blue">
        <ArrowLeft size={16} /> Back to forum
      </Link>
      <header className="max-w-[760px] py-[26px]">
        <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
          Your discussion activity
        </span>
        <h1 className="mt-2.5 mb-2 text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-.04em]">
          Your forum topics.
        </h1>
        <p className="m-0 text-muted">
          Review pending submissions and manage discussions you started.
        </p>
      </header>
      <StatusNotice notice={notice} />
      {state === 'loading' ? (
        <div className="my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center">
          <LoaderCircle className="animate-spin" />
          <h2 className="mt-2.5 mb-1 text-2xl">Loading topics</h2>
        </div>
      ) : state === 'signed-out' ? (
        <div className="my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center">
          <h2 className="mt-2.5 mb-1 text-2xl">Sign in to view your topics</h2>
          <p className="text-muted">Use the wallet control above.</p>
        </div>
      ) : state === 'error' ? (
        <div className="my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center">
          <CircleAlert size={24} />
          <h2 className="mt-2.5 mb-1 text-2xl">Topics unavailable</h2>
          <p className="text-muted">{loadError}</p>
          <ActionButton onClick={() => void load()}>Try again</ActionButton>
        </div>
      ) : (
        <section className="border-t border-navy">
          {items.length ? (
            items.map((topic) => (
              <article
                className="grid grid-cols-[1fr_auto] gap-4 border-b border-line py-3.5 max-sm:grid-cols-1"
                key={topic.id}
              >
                <div>
                  <small className="font-mono text-[9px] text-blue uppercase">
                    {topic.status.replaceAll('_', ' ')}
                  </small>
                  <h2 className="my-[3px] text-[17px]">
                    {topic.status === 'DRAFT' && !topic.title
                      ? 'Untitled draft'
                      : forumTopicTitle(topic.title, topic.state)}
                  </h2>
                  <p className="m-0 text-muted">
                    {FORUM_CATEGORIES.find((item) => item.value === topic.category)?.label}
                  </p>
                  {topic.status === 'DECLINED' && topic.moderationNote ? (
                    <p className="text-danger">{topic.moderationNote}</p>
                  ) : null}
                </div>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  {topic.status === 'PUBLISHED' || topic.status === 'LOCKED' ? (
                    <Link
                      className="inline-flex min-h-8 items-center rounded-md border border-navy bg-white px-2 text-[10px]"
                      href={`/community/forum/${topic.slug}`}
                    >
                      View discussion
                    </Link>
                  ) : null}
                  {topic.status === 'DRAFT' ||
                  topic.status === 'PENDING_REVIEW' ||
                  topic.status === 'PUBLISHED' ? (
                    <ActionButton
                      size="compact"
                      icon={<Pencil size={13} />}
                      onClick={() => setEditing(editing === topic.id ? undefined : topic.id)}
                    >
                      Edit
                    </ActionButton>
                  ) : null}
                  {topic.status !== 'REMOVED' ? (
                    <ActionButton
                      variant="danger"
                      size="compact"
                      icon={<Trash2 size={13} />}
                      onClick={() => setTopicToDelete(topic.id)}
                    >
                      Delete
                    </ActionButton>
                  ) : null}
                </span>
                {editing === topic.id ? (
                  <form
                    className="col-span-full grid grid-cols-1 gap-2 bg-blue-soft p-3"
                    onSubmit={(event) => void save(event, topic)}
                    onInvalid={validation.onInvalid}
                    onInput={validation.onInput}
                  >
                    <input
                      {...validation.fieldProps('title')}
                      className={textInputClass}
                      name="title"
                      defaultValue={topic.title ?? ''}
                      minLength={4}
                      maxLength={120}
                      required
                    />
                    <FormFieldError {...validation.errorProps('title')} />
                    <select className={selectClass} name="category" defaultValue={topic.category}>
                      {FORUM_CATEGORIES.map((item) => (
                        <option value={item.value} key={item.value}>
                          {item.label}
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
                    {topic.status === 'DRAFT' ? (
                      <>
                        <p className="m-0 text-[10px] text-muted">
                          Publishing requires at least {config.minimumPre.amount} PRE.
                        </p>
                        <span className="flex justify-end gap-2">
                          <ActionButton
                            type="submit"
                            name="intent"
                            value="save"
                            formNoValidate
                            disabled={saving}
                          >
                            Save draft
                          </ActionButton>
                          <ActionButton
                            type="submit"
                            name="intent"
                            value="publish"
                            variant="primary"
                            disabled={saving}
                          >
                            {config.topicModerationEnabled ? 'Submit for review' : 'Publish topic'}
                          </ActionButton>
                        </span>
                      </>
                    ) : (
                      <ActionButton variant="primary" disabled={saving}>
                        Save changes
                      </ActionButton>
                    )}
                  </form>
                ) : null}
              </article>
            ))
          ) : (
            <div className="border-y border-line py-7">
              <span className="hidden">00</span>
              <h2 className="m-0 text-lg">No topics yet.</h2>
              <p className="text-muted">Start a discussion from the forum.</p>
            </div>
          )}
        </section>
      )}
      <ConfirmationDialog
        open={Boolean(topicToDelete)}
        title="Delete topic?"
        description="This topic will no longer be visible in the forum."
        confirmLabel="Delete topic"
        pending={deleting}
        onCancel={() => setTopicToDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  );
}
