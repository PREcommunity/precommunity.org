import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ForumReply } from '@precommunity/shared';
import { ForumReplyList } from './forum-reply-list';

const reply: ForumReply = {
  id: 'reply-1',
  body: 'A useful response.',
  state: 'ACTIVE',
  editedAt: null,
  createdAt: '2026-09-01T12:00:00.000Z',
  author: {
    address: '0x1111111111111111111111111111111111111111',
    displayName: null,
    avatarUrl: null,
    websiteUrl: null,
  },
  parentReply: null,
};

function renderReplies(canModerate: boolean, canEditAsModerator: boolean) {
  return renderToStaticMarkup(
    <ForumReplyList
      replies={[reply]}
      totalCount={1}
      open={false}
      sessionAddress="0x2222222222222222222222222222222222222222"
      canModerate={canModerate}
      canEditAsModerator={canEditAsModerator}
      onReply={() => undefined}
      onEdit={async () => true}
      onDelete={() => undefined}
      onRemove={() => undefined}
    />,
  );
}

describe('ForumReplyList administrator editing', () => {
  it('shows Edit to a moderator for a locked discussion response', () => {
    expect(renderReplies(true, true)).toContain('Edit');
  });

  it('does not show Edit to another regular user in a locked discussion', () => {
    expect(renderReplies(false, false)).not.toContain('Edit');
  });
});
