import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRECOMMUNITY_ESCROW_ABI, PRE_KEYWORD_MARKET_ABI } from '@precommunity/shared';
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbiParameters,
} from 'viem';
import { describe, expect, it } from 'vitest';
const compiledArtifactPath = process.env.ESCROW_ARTIFACT_PATH
  ? resolve(process.env.ESCROW_ARTIFACT_PATH)
  : resolve(
      __dirname,
      '../../../../escrow/artifacts/contracts/PREcommunityEscrowV1.sol/PREcommunityEscrowV1.json',
    );
const compareCompiledArtifact = existsSync(compiledArtifactPath) ? it : it.skip;
const pinnedArtifactPath = resolve(
  __dirname,
  '../../../packages/shared/abi/PREcommunityEscrowV1.json',
);
const compiledKeywordMarketArtifactPath = resolve(
  __dirname,
  '../../../../escrow/artifacts/contracts/PREKeywordMarketV1.sol/PREKeywordMarketV1.json',
);
const compareCompiledKeywordMarketArtifact = existsSync(compiledKeywordMarketArtifactPath)
  ? it
  : it.skip;
const pinnedKeywordMarketArtifactPath = resolve(
  __dirname,
  '../../../packages/shared/abi/PREKeywordMarketV1.json',
);

describe('escrow ABI stability', () => {
  it('exposes the current escrow methods and no legacy surplus release', () => {
    const names = new Set<string>(
      PRECOMMUNITY_ESCROW_ABI.flatMap((item) => ('name' in item ? [item.name] : [])),
    );
    for (const name of [
      'createMonthlyGoal',
      'settleMonthlyGoal',
      'setMonthlySurplusPolicy',
      'requestMonthlyGoalStop',
      'cancelMonthlyGoal',
      'releaseCancelledFunds',
      'MonthlyPeriodSettled',
      'MonthlyTokenSettled',
      'CancelledFundsReleased',
    ]) {
      expect(names.has(name)).toBe(true);
    }
    expect(names.has('releaseSurplus')).toBe(false);
    expect(names.has('SurplusReleased')).toBe(false);
  });

  compareCompiledArtifact(
    'matches the separately compiled escrow artifact when it is available',
    () => {
      const artifact = JSON.parse(readFileSync(compiledArtifactPath, 'utf8')) as { abi: unknown[] };
      expect(PRECOMMUNITY_ESCROW_ABI).toEqual(artifact.abi);
    },
  );

  it('matches the only ABI artifact pinned in the application repository', () => {
    const artifact = JSON.parse(readFileSync(pinnedArtifactPath, 'utf8')) as { abi: unknown[] };
    expect(PRECOMMUNITY_ESCROW_ABI).toEqual(artifact.abi);
  });

  it('decodes the current GoalCreated event shape', () => {
    const goalId = `0x${'11'.repeat(32)}` as const;
    const creator = `0x${'22'.repeat(20)}` as const;
    const recipient = `0x${'33'.repeat(20)}` as const;
    const payoutRecipient = `0x${'44'.repeat(20)}` as const;
    const topics = encodeEventTopics({
      abi: PRECOMMUNITY_ESCROW_ABI,
      eventName: 'GoalCreated',
      args: { goalId, creator, recipient },
    });
    const data = encodeAbiParameters(
      parseAbiParameters(
        'address payoutRecipient, uint256 preTarget, uint256 usdcTarget, uint64 deadline, string title, string description, string metadataURI',
      ),
      [
        payoutRecipient,
        100n,
        200n,
        2_000_000_000n,
        'Public goal',
        'Fund public work.',
        'ipfs://bafygoal',
      ],
    );

    const decoded = decodeEventLog({
      abi: PRECOMMUNITY_ESCROW_ABI,
      data,
      topics: topics as unknown as [`0x${string}`, ...`0x${string}`[]],
    });

    expect(topics[0]).toBe('0xe06e4ad6c602fa1aec3bec461eae9596c48a424cb3e8df3dc93419c31a9bb460');

    expect(decoded).toEqual({
      eventName: 'GoalCreated',
      args: {
        goalId,
        creator,
        recipient,
        payoutRecipient,
        preTarget: 100n,
        usdcTarget: 200n,
        deadline: 2_000_000_000n,
        title: 'Public goal',
        description: 'Fund public work.',
        metadataURI: 'ipfs://bafygoal',
      },
    });
  });

  it('decodes GoalClosed values as the recipient entitlement', () => {
    const goalId = `0x${'11'.repeat(32)}` as const;
    const topics = encodeEventTopics({
      abi: PRECOMMUNITY_ESCROW_ABI,
      eventName: 'GoalClosed',
      args: { goalId },
    });
    const data = encodeAbiParameters(parseAbiParameters('uint256,uint256'), [700n, 250n]);

    const decoded = decodeEventLog({
      abi: PRECOMMUNITY_ESCROW_ABI,
      data,
      topics: topics as unknown as [`0x${string}`, ...`0x${string}`[]],
    });

    expect(decoded).toEqual({
      eventName: 'GoalClosed',
      args: {
        goalId,
        preRecipientEntitlement: 700n,
        usdcRecipientEntitlement: 250n,
      },
    });
  });
});

describe('PRE Keyword Market ABI stability', () => {
  it('exposes the reviewed immutable market surface', () => {
    const names = new Set<string>(
      PRE_KEYWORD_MARKET_ABI.flatMap((item) => ('name' in item ? [item.name] : [])),
    );
    for (const name of [
      'PRE',
      'stake',
      'requestUnstake',
      'unstake',
      'chargeStake',
      'withdrawAccrued',
      'positionOf',
      'stakeDetailsOf',
      'topStakeOf',
      'minimumStake',
      'setMinimumStake',
      'operator',
      'setOperator',
      'pause',
      'unpause',
      'Staked',
      'UnstakeRequested',
      'Unstaked',
      'StakeCharged',
      'PositionChanged',
      'MinimumStakeUpdated',
    ]) {
      expect(names.has(name)).toBe(true);
    }
    expect(names.has('quoteNonce')).toBe(false);
    expect(names.has('setQuoteSigner')).toBe(false);
  });

  it('projects the complete on-chain position state from one event', () => {
    const event = PRE_KEYWORD_MARKET_ABI.find(
      (item) => item.type === 'event' && item.name === 'PositionChanged',
    );
    if (!event || event.type !== 'event') throw new Error('PositionChanged ABI event is missing');
    expect(event.inputs.map((input) => input.name)).toEqual([
      'keywordId',
      'staker',
      'bidUsd',
      'eligible',
      'newStake',
      'positionVersion',
      'previousStake',
      'requiredCoveragePre',
      'withdrawAvailableAt',
    ]);
  });

  it('uses the three-argument stake selector of the current sibling contract', () => {
    const data = encodeFunctionData({
      abi: PRE_KEYWORD_MARKET_ABI,
      functionName: 'stake',
      args: [`0x${'11'.repeat(32)}`, 100n, 2_500_000n],
    });
    expect(data.slice(0, 10)).toBe('0x2daedd52');
    expect((data.length - 2) / 2).toBe(4 + 3 * 32);
  });

  it('decodes raw PositionChanged log data using the Solidity parameter order', () => {
    const keywordId = `0x${'11'.repeat(32)}` as const;
    const staker = `0x${'22'.repeat(20)}` as const;
    const topics = encodeEventTopics({
      abi: PRE_KEYWORD_MARKET_ABI,
      eventName: 'PositionChanged',
      args: { keywordId, staker },
    });
    const data = encodeAbiParameters(
      parseAbiParameters('uint256,bool,uint256,uint256,uint256,uint256,uint256'),
      [2_500_000n, false, 80n, 3n, 100n, 90n, 2_000_000_000n],
    );
    expect(topics[0]).toBe('0x7f77a4ff3b0a8fde7d6b8228a7127eb7ff94b616309daf707c3b093d4a9b841f');
    expect(
      decodeEventLog({
        abi: PRE_KEYWORD_MARKET_ABI,
        data,
        topics: topics as [`0x${string}`, ...`0x${string}`[]],
      }),
    ).toEqual({
      eventName: 'PositionChanged',
      args: {
        keywordId,
        staker,
        bidUsd: 2_500_000n,
        eligible: false,
        newStake: 80n,
        positionVersion: 3n,
        previousStake: 100n,
        requiredCoveragePre: 90n,
        withdrawAvailableAt: 2_000_000_000n,
      },
    });
  });

  compareCompiledKeywordMarketArtifact(
    'matches the separately compiled market artifact when it is available',
    () => {
      const artifact = JSON.parse(readFileSync(compiledKeywordMarketArtifactPath, 'utf8')) as {
        abi: unknown[];
      };
      expect(PRE_KEYWORD_MARKET_ABI).toEqual(artifact.abi);
    },
  );

  it('matches the market ABI artifact pinned in the application repository', () => {
    const artifact = JSON.parse(readFileSync(pinnedKeywordMarketArtifactPath, 'utf8')) as {
      abi: unknown[];
    };
    expect(PRE_KEYWORD_MARKET_ABI).toEqual(artifact.abi);
  });
});
