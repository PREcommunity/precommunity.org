import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CreateForumTopicDto,
  ForumDraftDto,
  ForumMinimumPreDto,
  ForumReplyDto,
  ForumSettingsDto,
} from './forum.dto';

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

  it('allows an incomplete draft while retaining topic length limits', async () => {
    const empty = plainToInstance(ForumDraftDto, { title: '', body: '', category: 'GENERAL' });
    const tooLong = plainToInstance(ForumDraftDto, { body: 'x'.repeat(5001) });
    const nulls = plainToInstance(ForumDraftDto, {
      title: null,
      body: null,
      category: null,
    });

    await expect(validate(empty)).resolves.toHaveLength(0);
    expect((await validate(tooLong)).map((error) => error.property)).toContain('body');
    expect((await validate(nulls)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['title', 'body', 'category']),
    );
  });

  it('accepts exact PRE amounts and rejects exponent or excess precision', async () => {
    for (const amount of ['0', '12', '12.5', '0.000000000000000001']) {
      await expect(validate(plainToInstance(ForumMinimumPreDto, { amount }))).resolves.toHaveLength(
        0,
      );
    }
    for (const amount of ['1e3', '-1', '1.0000000000000000001']) {
      expect(
        (await validate(plainToInstance(ForumMinimumPreDto, { amount }))).map(
          (error) => error.property,
        ),
      ).toContain('amount');
    }
  });
});
