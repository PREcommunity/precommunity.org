import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CommentDto, CreateProposalDto, ProposalSettingsDto } from './community.dto';

describe('community text validation', () => {
  it('trims valid proposal text before it reaches the service', async () => {
    const dto = plainToInstance(CreateProposalDto, {
      title: '  Public nodes  ',
      description: '  Fund resilient public infrastructure for the network.  ',
      category: '  Infrastructure  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toMatchObject({
      title: 'Public nodes',
      description: 'Fund resilient public infrastructure for the network.',
      category: 'Infrastructure',
    });
  });

  it('rejects proposal and comment fields made only of whitespace', async () => {
    const proposal = plainToInstance(CreateProposalDto, {
      title: '    ',
      description: '                    ',
      category: ' ',
    });
    const comment = plainToInstance(CommentDto, { body: '  ' });

    expect((await validate(proposal)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['title', 'description', 'category']),
    );
    expect((await validate(comment)).map((error) => error.property)).toContain('body');
  });

  it('requires a boolean proposal moderation setting', async () => {
    const dto = plainToInstance(ProposalSettingsDto, { proposalModerationEnabled: 'yes' });

    expect((await validate(dto)).map((error) => error.property)).toContain(
      'proposalModerationEnabled',
    );
  });
});
