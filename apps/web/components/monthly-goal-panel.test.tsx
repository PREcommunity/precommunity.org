import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GoalSummary, MonthlyGoalPhase } from '@precommunity/shared';
import { activeExplorerTransaction } from '@/lib/deployment';
import { MonthlyGoalPanel } from './monthly-goal-panel';

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('wagmi', () => ({
  useAccount: () => ({}),
  usePublicClient: () => undefined,
  useSendTransaction: () => ({}),
  useSwitchChain: () => ({}),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));

const hash = `0x${'11'.repeat(32)}` as const;
const address = `0x${'22'.repeat(20)}` as const;
const goal: GoalSummary = {
  id: 'monthly-goal',
  goalId: 'monthly-goal',
  slug: 'monthly-goal',
  title: 'Monthly goal',
  description: '',
  chainGoalId: hash,
  recipientAddress: address,
  creatorAddress: address,
  goalType: 'MONTHLY',
  deadline: '2026-09-01T00:00:00.000Z',
  creationTxHash: hash,
  creationBlock: '1',
  metadataStatus: 'NOT_SET',
  documents: [],
  status: 'OPEN',
  progress: [],
  monthly: {
    phase: 'SETTLEMENT_DUE',
    surplusPolicy: 'PAYOUT_ALL',
    firstSettlementAt: '2026-09-01T00:00:00.000Z',
    settlementDay: 1,
    stopRequestedAt: null,
    periodsSettled: 0,
    selectedPeriod: {
      periodIndex: 0,
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-09-01T00:00:00.000Z',
      surplusPolicy: 'PAYOUT_ALL',
      finalPeriod: false,
      settledAt: null,
      settlementTxHash: null,
      settlementBlock: null,
      settlementBlockHash: null,
      settlementLogIndex: null,
      assets: [],
    },
    lifetime: [],
  },
};

function renderPanel(phase: MonthlyGoalPhase) {
  return renderToStaticMarkup(
    <MonthlyGoalPanel
      goal={{ ...goal, monthly: { ...goal.monthly!, phase } }}
      periods={{ items: [], nextCursor: null }}
    />,
  );
}

describe('monthly settlement feedback', () => {
  it.each(['ACTIVE', 'CLOSED'] as const)(
    'retains confirmation and proof after a refresh changes the phase to %s',
    (phase) => {
      const message = 'Settlement confirmed. The updated period will appear after indexing.';
      vi.mocked(useState)
        .mockReturnValueOnce(['confirmed', vi.fn()])
        .mockReturnValueOnce([message, vi.fn()])
        .mockReturnValueOnce([hash, vi.fn()]);

      const html = renderPanel(phase);
      expect(html).toContain('role="status"');
      expect(html).toContain(message);
      expect(html).toContain(`href="${activeExplorerTransaction(hash)}"`);
      expect(html).not.toContain('Settle due periods');
    },
  );

  it.each(['ACTIVE', 'CLOSED'] as const)(
    'keeps the settlement panel hidden in %s before any action',
    (phase) => {
      const html = renderPanel(phase);
      expect(html).not.toContain('Public settlement');
      expect(html).not.toContain('role="status"');
    },
  );

  it('offers settlement when a period is due', () => {
    expect(renderPanel('SETTLEMENT_DUE')).toContain('Settle due periods');
  });
});
