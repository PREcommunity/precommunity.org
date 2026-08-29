import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExpenseCadence, FundingAsset, MonthlySurplusPolicy } from '@precommunity/database';
import { describe, expect, it } from 'vitest';
import { CreateExpenseDto, UpdateExpenseDto, UpdateGoalManagerDto } from './admin.dto';

const validCreateBody = {
  name: 'Public infrastructure',
  slug: 'public-infrastructure',
  description: '',
  purpose: 'Fund a verified community goal.',
  cadence: ExpenseCadence.ONE_TIME,
  recipientAddress: '0x1111111111111111111111111111111111111111',
  deadline: '2099-01-01T00:00:00.000Z',
  targets: [{ asset: FundingAsset.PRE, amount: '10' }],
};

describe('optional goal draft metadata validation', () => {
  it('accepts omitted or null subproject, category and discussion URL', async () => {
    await expect(
      validate(plainToInstance(CreateExpenseDto, validCreateBody)),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(CreateExpenseDto, {
          ...validCreateBody,
          subprojectId: null,
          category: null,
          discussionUrl: null,
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it('rejects empty identifiers and categories or an invalid discussion URL', async () => {
    const errors = await validate(
      plainToInstance(CreateExpenseDto, {
        ...validCreateBody,
        subprojectId: 'not-a-uuid',
        category: '',
        discussionUrl: 'ftp://example.org/discussion',
      }),
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['subprojectId', 'category', 'discussionUrl']),
    );
  });

  it('allows null to clear updateable metadata but rejects empty replacements', async () => {
    await expect(
      validate(
        plainToInstance(UpdateExpenseDto, {
          category: null,
          discussionUrl: null,
        }),
      ),
    ).resolves.toHaveLength(0);

    const errors = await validate(
      plainToInstance(UpdateExpenseDto, {
        category: '',
        discussionUrl: 'not-a-url',
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['category', 'discussionUrl']),
    );
  });

  it('accepts all fields used by the unified draft editor', async () => {
    const errors = await validate(
      plainToInstance(UpdateExpenseDto, {
        subprojectId: '11111111-1111-4111-8111-111111111111',
        slug: 'edited-goal',
        cadence: ExpenseCadence.MONTHLY,
        deadline: null,
        monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
        firstSettlementAt: '2099-02-15T00:00:00.000Z',
        metadataUri: null,
      }),
    );

    expect(errors).toHaveLength(0);
  });
});

describe('monthly first settlement input validation', () => {
  const monthlyBody = {
    ...validCreateBody,
    cadence: ExpenseCadence.MONTHLY,
    deadline: undefined,
    monthlySurplusPolicy: MonthlySurplusPolicy.ROLL_OVER,
  };

  it('accepts the default, null reset and an explicit UTC-midnight date', async () => {
    await expect(validate(plainToInstance(CreateExpenseDto, monthlyBody))).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(CreateExpenseDto, { ...monthlyBody, firstSettlementAt: null })),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(CreateExpenseDto, {
          ...monthlyBody,
          firstSettlementAt: '2099-02-15T00:00:00.000Z',
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it('rejects local offsets, date-only values and times other than UTC midnight', async () => {
    for (const firstSettlementAt of [
      '2099-02-15',
      '2099-02-15T00:00:00+01:00',
      '2099-02-15T12:00:00.000Z',
    ]) {
      const errors = await validate(
        plainToInstance(CreateExpenseDto, { ...monthlyBody, firstSettlementAt }),
      );
      expect(errors.map((error) => error.property)).toContain('firstSettlementAt');
    }
  });
});

describe('goal manager policy validation', () => {
  it('requires an explicit boolean desired state', async () => {
    await expect(
      validate(plainToInstance(UpdateGoalManagerDto, { enabled: false })),
    ).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(UpdateGoalManagerDto, { enabled: 'false' })),
    ).resolves.not.toHaveLength(0);
  });
});
