'use client';

import { useCallback, useState } from 'react';
import { Share } from 'lucide-react';
import { FaDiscord, FaTelegram, FaXTwitter } from 'react-icons/fa6';
import {
  shareText,
  telegramShareUrl,
  xShareUrl,
  type ShareContentKind,
  type ShareTarget,
} from '@/lib/share';
import { Toast, type ToastState } from './toast';

interface ShareLinksProps {
  kind: ShareContentKind;
  title: string;
}

function currentShareTarget(kind: ShareContentKind, title: string): ShareTarget {
  const url = new URL(window.location.href);
  url.hash = '';
  return { kind, title, url: url.toString() };
}

export function ShareLinks({ kind, title }: ShareLinksProps) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  function openShare(platform: 'x' | 'telegram') {
    const target = currentShareTarget(kind, title);
    const shareUrl = platform === 'x' ? xShareUrl(target) : telegramShareUrl(target);
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  }

  function shareToDiscord() {
    const target = currentShareTarget(kind, title);
    window.open('https://discord.com/channels/@me', '_blank', 'noopener,noreferrer');
    void navigator.clipboard.writeText(target.url).then(
      () =>
        setToast({
          type: 'success',
          message: 'Link copied. Choose a Discord conversation to post it.',
        }),
      () =>
        setToast({
          type: 'error',
          message: 'Could not copy the link. Copy the page URL to post it in Discord.',
        }),
    );
  }

  async function openNativeShare() {
    const target = currentShareTarget(kind, title);
    if (!navigator.share) {
      try {
        await navigator.clipboard.writeText(target.url);
        setToast({ type: 'success', message: 'Link copied.' });
      } catch {
        setToast({
          type: 'error',
          message: 'Sharing is not supported. Copy the page URL to share it.',
        });
      }
      return;
    }
    try {
      await navigator.share({ title: target.title, text: shareText(target), url: target.url });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setToast({ type: 'error', message: 'Could not open the sharing menu.' });
    }
  }

  return (
    <div className="mt-4" aria-label="Share this page">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-muted uppercase">Share</span>
        <div className="flex items-center gap-1 max-sm:gap-0.5">
          <button
            className="inline-flex size-7 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-blue transition-transform duration-150 hover:translate-x-0.5 max-sm:size-11"
            type="button"
            onClick={() => openShare('x')}
            aria-label="Share on X"
            title="Share on X"
          >
            <FaXTwitter className="size-3.5 max-sm:size-4" aria-hidden="true" />
          </button>
          <button
            className="inline-flex size-7 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-blue transition-transform duration-150 hover:translate-x-0.5 max-sm:size-11"
            type="button"
            onClick={() => openShare('telegram')}
            aria-label="Share on Telegram"
            title="Share on Telegram"
          >
            <FaTelegram className="size-3.5 max-sm:size-4" aria-hidden="true" />
          </button>
          <button
            className="inline-flex size-7 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-blue transition-transform duration-150 hover:translate-x-0.5 max-sm:size-11"
            type="button"
            onClick={shareToDiscord}
            aria-label="Share on Discord"
            title="Share on Discord"
          >
            <FaDiscord className="size-3.5 max-sm:size-4" aria-hidden="true" />
          </button>
        </div>
        <button
          className="inline-flex min-h-7 cursor-pointer items-center gap-1 border-0 bg-transparent px-1 py-0 text-[11px] text-blue transition-transform duration-150 hover:translate-x-0.5 max-sm:min-h-11 max-sm:px-2"
          type="button"
          onClick={() => void openNativeShare()}
        >
          <Share size={13} /> Share
        </button>
      </div>
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
