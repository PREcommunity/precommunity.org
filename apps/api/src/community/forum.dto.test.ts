import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateForumTopicDto, ForumReplyDto, ForumSettingsDto } from './forum.dto';

describe('forum validation', () => {
  it('trims topic text and accepts a fixed category', async () => {
    const dto = plainToInstance(CreateForumTopicDto, {
      title: '  Better community search  ',
      body: '  How should the community organize research links?  ',
      category: 'IDEAS_FEEDBACK',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toMatchObject({
      title: 'Better community search',
      body: 'How should the community organize research links?',
      category: 'IDEAS_FEEDBACK',
    });
  });

  it('rejects unknown categories and whitespace-only replies', async () => {
    const topic = plainToInstance(CreateForumTopicDto, {
      title: 'Valid title',
      body: 'A sufficiently long opening post.',
      category: 'RANDOM',
    });
    const reply = plainToInstance(ForumReplyDto, { body: '  ' });
    expect((await validate(topic)).map((error) => error.property)).toContain('category');
    expect((await validate(reply)).map((error) => error.property)).toContain('body');
  });

  it('accepts an optional quoted reply UUID and rejects malformed values', async () => {
    const quoted = plainToInstance(ForumReplyDto, {
      body: 'Useful response',
      parentReplyId: '00000000-0000-4000-8000-000000000010',
    });
    const malformed = plainToInstance(ForumReplyDto, {
      body: 'Useful response',
      parentReplyId: 'not-a-uuid',
    });
    await expect(validate(quoted)).resolves.toHaveLength(0);
    expect((await validate(malformed)).map((error) => error.property)).toContain('parentReplyId');
  });

  it('requires a boolean moderation setting', async () => {
    const dto = plainToInstance(ForumSettingsDto, { topicModerationEnabled: 'yes' });
    expect((await validate(dto)).map((error) => error.property)).toContain(
      'topicModerationEnabled',
    );
  });
});
