import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExpenseStatus, FundingGoalStatus, Prisma } from '@precommunity/database';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

const token = 's'.repeat(43);
const draft = {
  id: '00000000-0000-4000-8000-000000000010',
  slug: 'internal-slug',
  name: 'Community infrastructure',
  purpose: 'Public description',
  description: 'PRIVATE INTERNAL NOTES',
  previewToken: token,
  pendingChainTxHash: 'PRIVATE PENDING TRANSACTION',
  status: ExpenseStatus.DRAFT,
  category: 'Infrastructure',
  cadence: 'ONE_TIME',
  recipientAddress: '0x1111111111111111111111111111111111111111',
  deadline: new Date('2028-01-31T12:00:00.000Z'),
  monthlySurplusPolicy: null,
  firstSettlementAtOverride: null,
  discussionUrl: 'https://example.com/discussion',
  metadataUri: null,
  metadataDocuments: [{ label: 'Brief', url: 'https://example.com/brief' }],
  subproject: { name: 'Infrastructure', slug: 'infrastructure' },
  targets: [
    { asset: 'PRE', amount: new Prisma.Decimal('9007199254740993.000000000000000001') },
    { asset: 'USDC', amount: new Prisma.Decimal('0') },
  ],
  goals: [] as Array<{ slug: string }>,
};

function previewService(value: unknown = draft) {
  const findUnique = vi.fn().mockResolvedValue(value);
  // Only the draft read is available: publication, ledger and network calls fail the test.
  const service = new PublicService({ expense: { findUnique } } as never);
  return { service, findUnique };
}

afterEach(() => vi.unstubAllGlobals());

describe('unlisted goal previews', () => {
  it('returns only public-facing draft fields without publishing or fetching metadata', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { service, findUnique } = previewService();
    const preview = await service.goalPreview(token);
    expect(preview).toEqual({
      kind: 'draft',
      draft: {
        title: draft.name,
        description: draft.purpose,
        status: 'DRAFT',
        category: draft.category,
        subproject: draft.subproject,
        recipientAddress: draft.recipientAddress,
        cadence: 'ONE_TIME',
        deadline: '2028-01-31T12:00:00.000Z',
        monthlySurplusPolicy: null,
        firstSettlementAt: null,
        discussionUrl: draft.discussionUrl,
        metadataUri: null,
        documents: draft.metadataDocuments,
        targets: [{ asset: 'PRE', amount: '9007199254740993.000000000000000001' }],
      },
    });
    const serialized = JSON.stringify(preview);
    for (const secret of [draft.id, draft.slug, draft.description, token, draft.pendingChainTxHash])
      expect(serialized).not.toContain(secret);
    expect(findUnique.mock.calls[0]![0].select).not.toHaveProperty('description');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the latest saved content on every request, even after a deadline has passed', async () => {
    const { service, findUnique } = previewService({
      ...draft,
      deadline: new Date('2020-01-01T00:00:00.000Z'),
    });
    expect((await service.goalPreview(token)).kind).toBe('draft');
    findUnique.mockResolvedValue({ ...draft, purpose: 'Revised public description' });
    await expect(service.goalPreview(token)).resolves.toMatchObject({
      draft: { description: 'Revised public description' },
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it.each(['', draft.id, draft.slug, 'short', `${'s'.repeat(42)}!`, 's'.repeat(44)])(
    'rejects invalid preview credentials before querying the database: %s',
    async (value) => {
      const { service, findUnique } = previewService();
      await expect(service.goalPreview(value)).rejects.toBeInstanceOf(NotFoundException);
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it('requires an enabled token on an unarchived record in the application project', async () => {
    const { service, findUnique } = previewService(null);
    await expect(service.goalPreview(token)).rejects.toBeInstanceOf(NotFoundException);
    expect(findUnique.mock.calls[0]![0].where).toEqual({
      previewToken: token,
      archivedAt: null,
      status: { in: ['DRAFT', 'PENDING_CHAIN', 'PUBLISHED'] },
      subproject: { project: { slug: 'precommunity' } },
    });
  });

  it('keeps pending monthly publication as a read-only preview', async () => {
    const { service } = previewService({
      ...draft,
      status: ExpenseStatus.PENDING_CHAIN,
      cadence: 'MONTHLY',
      deadline: null,
      monthlySurplusPolicy: 'ROLL_OVER',
      firstSettlementAtOverride: new Date('2028-02-29T00:00:00.000Z'),
    });
    await expect(service.goalPreview(token)).resolves.toMatchObject({
      kind: 'draft',
      draft: {
        status: 'PENDING_CHAIN',
        cadence: 'MONTHLY',
        deadline: null,
        monthlySurplusPolicy: 'ROLL_OVER',
        firstSettlementAt: '2028-02-29T00:00:00.000Z',
      },
    });
  });

  it('resolves the recorded public slug only from confirmed goals on the active network', async () => {
    const { service, findUnique } = previewService({
      ...draft,
      status: ExpenseStatus.PUBLISHED,
      goals: [{ slug: 'public-slug-after-collision' }],
    });
    await expect(service.goalPreview(token)).resolves.toEqual({
      kind: 'published',
      slug: 'public-slug-after-collision',
    });
    expect(findUnique.mock.calls[0]![0].select.goals).toMatchObject({
      where: {
        chainId: config.deployment.chainId,
        creationTxHash: { not: null },
        creationBlock: { not: null },
        status: {
          in: [
            FundingGoalStatus.OPEN,
            FundingGoalStatus.CLOSED,
            FundingGoalStatus.SETTLED,
            FundingGoalStatus.CANCELLED,
          ],
        },
      },
      select: { slug: true },
    });
  });

  it('does not treat a published marker alone as a confirmed public goal', async () => {
    const { service } = previewService({ ...draft, status: ExpenseStatus.PUBLISHED });
    await expect(service.goalPreview(token)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters unsafe links and malformed supporting material from stored drafts', async () => {
    const { service } = previewService({
      ...draft,
      discussionUrl: 'javascript:alert(1)',
      metadataUri: 'javascript:alert(2)',
      metadataDocuments: [
        ...draft.metadataDocuments,
        { label: 'Bad', url: 'javascript:alert(3)' },
        { label: 'Invalid', url: 123 },
        null,
        ['invalid'],
      ],
    });
    await expect(service.goalPreview(token)).resolves.toMatchObject({
      draft: { discussionUrl: null, metadataUri: null, documents: draft.metadataDocuments },
    });
  });
});

describe('preview HTTP policy', () => {
  it('allows anonymous reads and sets privacy headers even when the link is unavailable', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicController)).toBeUndefined();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PublicController.prototype.goalPreview),
    ).toBeUndefined();
    const { service } = previewService(null);
    const response = { setHeader: vi.fn() };
    await expect(
      new PublicController(service).goalPreview(token, response as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(response.setHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store'],
      ['X-Robots-Tag', 'noindex, nofollow, noarchive'],
      ['Referrer-Policy', 'no-referrer'],
    ]);
  });
});
