'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, LoaderCircle } from 'lucide-react';
import type { ForumNotificationsPage } from '@precommunity/shared';
import { ApiError, clientApiJson, clientApiRequest } from '@/lib/http';
import { AUTH_CHANGED_EVENT, FORUM_NOTIFICATIONS_CHANGED_EVENT } from '@/lib/auth-events';
import { formatUtcTimestamp } from '@/lib/format';
import { HEADER_OVERLAY_EVENT, openHeaderOverlay } from './header-overlay';

export function ForumNotificationMenu() {
  const pathname = usePathname();
  const requestRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<ForumNotificationsPage | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const page = await clientApiJson<ForumNotificationsPage>(
        '/v1/community/forum/notifications',
        { signal: controller.signal },
        'Forum notifications',
      );
      if (requestRef.current !== controller) return;
      setNotifications(page);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (requestRef.current !== controller) return;
      if (error instanceof ApiError && error.status === 401) {
        setNotifications(null);
        return;
      }
      setError(true);
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(AUTH_CHANGED_EVENT, load);
    window.addEventListener(FORUM_NOTIFICATIONS_CHANGED_EVENT, load);
    return () => {
      requestRef.current?.abort();
      window.removeEventListener(AUTH_CHANGED_EVENT, load);
      window.removeEventListener(FORUM_NOTIFICATIONS_CHANGED_EVENT, load);
    };
  }, [load, pathname]);

  useEffect(() => {
    const close = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== 'notifications') setOpen(false);
    };
    window.addEventListener(HEADER_OVERLAY_EVENT, close);
    return () => window.removeEventListener(HEADER_OVERLAY_EVENT, close);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) openHeaderOverlay('notifications');
  }

  async function markRead(id: string) {
    const notification = notifications?.items.find((item) => item.id === id);
    if (!notification || notification.readAt) return;
    setNotifications((current) =>
      current
        ? {
            unreadCount: Math.max(0, current.unreadCount - 1),
            items: current.items.map((item) =>
              item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
            ),
          }
        : current,
    );
    try {
      await clientApiRequest(
        `/v1/community/forum/notifications/${id}/read`,
        { method: 'POST' },
        'Notification update',
      );
    } catch {
      void load();
    }
  }

  async function markAllRead() {
    try {
      await clientApiRequest(
        '/v1/community/forum/notifications/read-all',
        { method: 'POST' },
        'Notification update',
      );
      setNotifications((current) =>
        current
          ? {
              unreadCount: 0,
              items: current.items.map((item) => ({
                ...item,
                readAt: item.readAt ?? new Date().toISOString(),
              })),
            }
          : current,
      );
    } catch {
      void load();
    }
  }

  if (!notifications && !loading && !error) return null;

  return (
    <div className="relative">
      <button
        className="relative grid size-9 cursor-pointer place-items-center rounded-full border border-navy bg-transparent transition-colors duration-150 hover:border-blue hover:bg-blue-soft aria-expanded:border-blue aria-expanded:bg-blue-soft dark:border-current"
        type="button"
        aria-label="Forum notifications"
        aria-expanded={open}
        onClick={toggle}
      >
        <Bell size={17} />
        {notifications?.unreadCount ? (
          <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-blue px-1 text-[9px] font-bold text-navy">
            {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <section
          className="absolute top-[calc(100%+9px)] right-0 z-50 w-[min(360px,calc(100vw-32px))] border border-line bg-paper p-2 shadow-[0_18px_32px_rgba(9,28,51,.12)]"
          aria-label="Forum notifications"
        >
          <header className="flex items-center justify-between gap-3 border-b border-line px-2 py-1.5">
            <strong className="text-xs">Forum notifications</strong>
            {notifications?.unreadCount ? (
              <button
                className="cursor-pointer border-0 bg-transparent p-0 text-[10px] text-blue transition-transform duration-150 hover:translate-x-0.5"
                type="button"
                onClick={() => void markAllRead()}
              >
                Mark all read
              </button>
            ) : (
              <span className="text-[10px] text-muted">0 unread</span>
            )}
          </header>
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-5 text-xs text-muted">
              <LoaderCircle className="animate-spin" size={15} /> Loading notifications…
            </div>
          ) : error ? (
            <p className="m-0 px-2 py-5 text-xs text-danger">
              Forum notifications are temporarily unavailable.
            </p>
          ) : notifications?.items.length ? (
            <div>
              {notifications.items.map((notification) => (
                <Link
                  className={`block border-b border-line px-2 py-2.5 text-xs transition-colors duration-150 hover:bg-blue-soft ${notification.readAt ? 'text-muted' : 'bg-white'}`}
                  href={`/community/forum/${notification.topic.slug}#reply-${notification.replyId}`}
                  key={notification.id}
                  onClick={() => {
                    void markRead(notification.id);
                    setOpen(false);
                  }}
                >
                  <strong className="text-navy">
                    {notification.actor.displayName ||
                      `${notification.actor.address.slice(0, 6)}…${notification.actor.address.slice(-4)}`}
                  </strong>{' '}
                  replied in{' '}
                  <span className="font-bold text-navy">
                    {notification.topic.title ?? 'an unavailable topic'}
                  </span>
                  <time className="mt-1 block text-[10px] text-muted">
                    {formatUtcTimestamp(notification.createdAt)}
                  </time>
                </Link>
              ))}
            </div>
          ) : (
            <p className="m-0 px-2 py-5 text-xs text-muted">No forum notifications yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
