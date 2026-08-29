import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAdCampaignDto, ListAdAdminReportsDto, ReportAdDto } from './ads.dto';

describe('PRE Keyword Market request validation', () => {
  it('trims a valid creative and accepts an HTTPS destination', async () => {
    const dto = plainToInstance(CreateAdCampaignDto, {
      keyword: '  Bitcoin Poland  ',
      headline: '  Search result  ',
      description: '  A useful destination for this query.  ',
      destinationUrl: '  https://example.com/result  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toMatchObject({
      keyword: 'Bitcoin Poland',
      headline: 'Search result',
      description: 'A useful destination for this query.',
      destinationUrl: 'https://example.com/result',
    });
  });

  it('allows an empty optional headline while keeping description and destination required', async () => {
    const dto = plainToInstance(CreateAdCampaignDto, {
      keyword: 'bitcoin',
      headline: '   ',
      description: 'A required description.',
      destinationUrl: 'https://example.com/',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.headline).toBe('');
  });

  it('rejects oversized creative text and non-HTTPS destinations', async () => {
    const dto = plainToInstance(CreateAdCampaignDto, {
      keyword: 'bitcoin',
      headline: 'h'.repeat(61),
      description: 'd'.repeat(161),
      destinationUrl: 'http://example.com/result',
    });
    const fields = (await validate(dto)).map((error) => error.property);

    expect(fields).toEqual(expect.arrayContaining(['headline', 'description', 'destinationUrl']));
  });

  it('allows only known report reasons and comments up to 500 characters', async () => {
    const invalidReason = plainToInstance(ReportAdDto, { reason: 'NOT_A_REASON' });
    const longComment = plainToInstance(ReportAdDto, {
      reason: 'OTHER',
      comment: 'x'.repeat(501),
    });

    expect((await validate(invalidReason)).map((error) => error.property)).toContain('reason');
    expect((await validate(longComment)).map((error) => error.property)).toContain('comment');
  });

  it('bounds report-group pagination and validates revision cursors', async () => {
    const valid = plainToInstance(ListAdAdminReportsDto, {
      status: 'OPEN',
      cursor: '00000000-0000-4000-8000-000000000001',
      limit: '100',
    });
    const invalid = plainToInstance(ListAdAdminReportsDto, {
      status: 'UNKNOWN',
      cursor: 'not-a-revision-id',
      limit: '101',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.limit).toBe(100);
    expect((await validate(invalid)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['status', 'cursor', 'limit']),
    );
  });
});
