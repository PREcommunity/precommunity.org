import Link from 'next/link';
import { CornerUpLeft, Pencil, ShieldX, Trash2 } from 'lucide-react';
import type { ForumReply } from '@precommunity/shared';
import { formatUtcTimestamp } from '@/lib/format';

interface ForumReplyListProps {
  replies: ForumReply[];
  totalCount: number;
  open: boolean;
  sessionAddress: string;
  canModerate: boolean;
  onReply: (reply: ForumReply) => void;
  onEdit: (reply: ForumReply) => void;
  onDelete: (reply: ForumReply) => void;
  onRemove: (reply: ForumReply) => void;
}

function authorLabel(reply: Pick<ForumReply, 'author'>) {
  return (
    reply.author.displayName ||
    `${reply.author.address.slice(0, 6)}…${reply.author.address.slice(-4)}`
  );
}

export function ForumReplyList({
  replies,
  totalCount,
  open,
  sessionAddress,
  canModerate,
  onReply,
  onEdit,
  onDelete,
  onRemove,
}: ForumReplyListProps) {
  return replies.map((reply, index) => {
    const own = sessionAddress.toLowerCase() === reply.author.address.toLowerCase();
    const position = Math.max(totalCount - replies.length, 0) + index + 1;
    return (
      <article
        className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 border-b border-line py-3.5 max-sm:grid-cols-[20px_minmax(0,1fr)]"
        id={`reply-${reply.id}`}
        key={reply.id}
      >
        <span className="font-mono text-[9px] text-blue">{String(position).padStart(2, '0')}</span>
        <div className="min-w-0">
          <div className="flex justify-between gap-4 text-[11px] max-sm:flex-col max-sm:gap-0.5">
            <Link href={`/community/profiles/${reply.author.address}`}>{authorLabel(reply)}</Link>
            <time className="text-muted">
              {formatUtcTimestamp(reply.createdAt)}
              {reply.editedAt ? ' · edited' : ''}
            </time>
          </div>
          {reply.parentReply ? (
            <a
              className="mt-2 block border-l-2 border-line bg-blue-soft px-2 py-1 text-[10px] text-muted hover:border-blue"
              href={`#reply-${reply.parentReply.id}`}
            >
              <strong className="text-navy">{authorLabel(reply.parentReply)}</strong>
              <span className="block truncate">
                {reply.parentReply.body ?? 'This response is no longer available.'}
              </span>
            </a>
          ) : null}
          <p className={`mb-0 whitespace-pre-wrap ${reply.state !== 'ACTIVE' ? 'text-muted' : ''}`}>
            {reply.body ??
              (reply.state === 'REMOVED' ? 'Removed by a moderator.' : 'Deleted by the author.')}
          </p>
          {reply.state === 'ACTIVE' && reply.body ? (
            <div className="mt-1.5 flex gap-2">
              {open ? (
                <button
                  className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-blue transition-transform duration-150 hover:translate-x-0.5"
                  onClick={() => onReply(reply)}
                >
                  <CornerUpLeft size={12} /> Reply
                </button>
              ) : null}
              {own && open ? (
                <button
                  className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-blue transition-transform duration-150 hover:translate-x-0.5"
                  onClick={() => onEdit(reply)}
                >
                  <Pencil size={12} /> Edit
                </button>
              ) : null}
              {own ? (
                <button
                  className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-danger transition-transform duration-150 hover:translate-x-0.5"
                  onClick={() => onDelete(reply)}
                >
                  <Trash2 size={12} /> Delete
                </button>
              ) : null}
              {canModerate ? (
                <button
                  className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[10px] text-danger transition-transform duration-150 hover:translate-x-0.5"
                  onClick={() => onRemove(reply)}
                >
                  <ShieldX size={12} /> Remove as moderator
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
    );
  });
}
