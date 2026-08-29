'use client';

import { useEffect, useRef, useState } from 'react';
import type { ForumRepliesPage, ForumReply, ForumTopicDetail } from '@precommunity/shared';
import { clientApiJson } from '@/lib/http';
import { resolveApiAssetUrl } from '@/lib/api';
import { subscribeToReplyHash } from '@/lib/forum-reply-hash';

function resolveReplyAssets(reply: ForumReply): ForumReply {
  return {
    ...reply,
    author: { ...reply.author, avatarUrl: resolveApiAssetUrl(reply.author.avatarUrl) },
    parentReply: reply.parentReply
      ? {
          ...reply.parentReply,
          author: {
            ...reply.parentReply.author,
            avatarUrl: resolveApiAssetUrl(reply.parentReply.author.avatarUrl),
          },
        }
      : null,
  };
}

export function useForumReplies(topic: ForumTopicDetail, reportError: (message: string) => void) {
  const [replies, setReplies] = useState(topic.replies);
  const [nextCursor, setNextCursor] = useState(topic.nextReplyCursor ?? null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const repliesRef = useRef(replies);
  const nextCursorRef = useRef(nextCursor);

  useEffect(() => {
    repliesRef.current = topic.replies;
    nextCursorRef.current = topic.nextReplyCursor ?? null;
    setReplies(topic.replies);
    setNextCursor(topic.nextReplyCursor ?? null);
  }, [topic.nextReplyCursor, topic.replies, topic.slug]);

  useEffect(() => {
    let controller: AbortController | null = null;

    async function loadTargetReply(targetId: string, signal: AbortSignal) {
      let cursor = nextCursorRef.current;
      let found = false;
      let loaded: ForumReply[] = [];

      while (cursor && !found && !signal.aborted) {
        const params = new URLSearchParams({ cursor, limit: '100' });
        const page = await clientApiJson<ForumRepliesPage>(
          `/v1/community/forum/topics/${encodeURIComponent(topic.slug)}/replies?${params}`,
          { signal },
          'Forum replies',
        );
        const items = page.items.map(resolveReplyAssets);
        loaded = [...items, ...loaded];
        found = items.some((reply) => reply.id === targetId);
        cursor = page.nextCursor;
      }

      if (signal.aborted || !loaded.length) return;
      setReplies((current) => {
        const loadedIds = new Set(loaded.map((reply) => reply.id));
        const merged = [...loaded, ...current.filter((reply) => !loadedIds.has(reply.id))];
        repliesRef.current = merged;
        return merged;
      });
      nextCursorRef.current = cursor;
      setNextCursor(cursor);
    }

    function handleHashChange(targetId: string | null) {
      controller?.abort();
      controller = null;

      if (!targetId) return;
      if (repliesRef.current.some((reply) => reply.id === targetId)) {
        requestAnimationFrame(() => {
          document.getElementById(`reply-${targetId}`)?.scrollIntoView({ block: 'center' });
        });
        return;
      }
      if (!nextCursorRef.current) return;

      controller = new AbortController();
      const request = controller;
      void loadTargetReply(targetId, request.signal).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          reportError(
            error instanceof Error ? error.message : 'The linked response could not be loaded.',
          );
        }
      });
    }

    const unsubscribe = subscribeToReplyHash(window, handleHashChange);
    return () => {
      unsubscribe();
      controller?.abort();
    };
  }, [reportError, topic.nextReplyCursor, topic.replies, topic.slug]);

  useEffect(() => {
    const target = window.location.hash
      ? document.getElementById(window.location.hash.slice(1))
      : null;
    target?.scrollIntoView({ block: 'center' });
  }, [replies]);

  async function loadEarlier() {
    if (!nextCursor) return;
    setLoadingEarlier(true);
    try {
      const params = new URLSearchParams({ cursor: nextCursor, limit: '50' });
      const page = await clientApiJson<ForumRepliesPage>(
        `/v1/community/forum/topics/${encodeURIComponent(topic.slug)}/replies?${params}`,
        undefined,
        'Earlier forum replies',
      );
      const items = page.items.map(resolveReplyAssets);
      setReplies((current) => {
        const currentIds = new Set(current.map((reply) => reply.id));
        const merged = [...items.filter((reply) => !currentIds.has(reply.id)), ...current];
        repliesRef.current = merged;
        return merged;
      });
      nextCursorRef.current = page.nextCursor;
      setNextCursor(page.nextCursor);
    } catch (error) {
      reportError(
        error instanceof Error ? error.message : 'Earlier responses could not be loaded.',
      );
    } finally {
      setLoadingEarlier(false);
    }
  }

  return { loadingEarlier, loadEarlier, nextCursor, replies };
}
