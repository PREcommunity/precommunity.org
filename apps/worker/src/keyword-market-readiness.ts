import type { PrismaClient } from '@precommunity/database';
import { PRE_KEYWORD_MARKET_ABI } from '@precommunity/shared';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  erc20Abi,
  getAddress,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
} from 'viem';
import { adsIndexerStateKey, finalizedAdsBlock } from './ads-projection';

export type KeywordMarketCheckPhase = 'preopen' | 'active';

interface MarketArtifact {
  contractName: string;
  abi: readonly unknown[];
  deployedBytecode: string;
  immutableReferences: Record<string, Array<{ start: number; length: number }>>;
  buildInfoId: string;
}

export interface ReviewedMarketArtifact {
  artifact: MarketArtifact;
  artifactSha256: string;
}

export interface KeywordMarketCheckOptions {
  chainId: number;
  contractAddress: string | null;
  deploymentBlock: string | null;
  preAddress: string;
  safeAddress: string | null | undefined;
  confirmations: number;
  phase?: KeywordMarketCheckPhase;
  now?: Date;
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function loadReviewedMarketArtifact(): ReviewedMarketArtifact {
  const raw = readFileSync(
    resolve(__dirname, '../../../packages/shared/abi/PREKeywordMarketV1.json'),
  );
  return {
    artifact: JSON.parse(raw.toString('utf8')) as MarketArtifact,
    artifactSha256: sha256(raw),
  };
}

export function keywordMarketCheckPhase(args: string[], defaultPhase?: KeywordMarketCheckPhase) {
  if (args[0] === '--') args = args.slice(1);
  if (args.length === 0) return defaultPhase;
  if (args.length !== 2 || args[0] !== '--phase' || !['preopen', 'active'].includes(args[1]!)) {
    throw new Error('Usage: --phase preopen|active');
  }
  return args[1] as KeywordMarketCheckPhase;
}

export function normalizedMarketRuntime(bytecode: string, artifact: MarketArtifact) {
  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(bytecode))
    throw new Error('Keyword Market runtime bytecode is missing or invalid');
  if (!artifact.immutableReferences || Object.keys(artifact.immutableReferences).length === 0) {
    throw new Error('Reviewed Keyword Market artifact is missing immutable references');
  }
  const runtime = bytecode.slice(2).toLowerCase().split('');
  for (const references of Object.values(artifact.immutableReferences)) {
    for (const { start, length } of references) {
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(length) ||
        start < 0 ||
        length !== 32 ||
        (start + length) * 2 > runtime.length
      ) {
        throw new Error('Reviewed Keyword Market immutable reference is invalid');
      }
      runtime.fill('0', start * 2, (start + length) * 2);
    }
  }
  return `0x${runtime.join('')}`;
}

/** Read-only, feature-independent gate for a reviewed contract and its finalized Prisma projection. */
export async function verifyKeywordMarketReadiness<
  transport extends Transport,
  chain extends Chain | undefined,
  account extends Account | undefined,
>(
  client: PublicClient<transport, chain, account>,
  database: Pick<PrismaClient, 'adIndexerState'>,
  options: KeywordMarketCheckOptions,
  reviewed = loadReviewedMarketArtifact(),
) {
  if (!options.contractAddress || !options.deploymentBlock)
    throw new Error('Keyword Market deployment is not configured');
  if (!options.safeAddress)
    throw new Error('Keyword Market readiness requires a configured Safe address');
  const address = getAddress(options.contractAddress);
  const preAddress = getAddress(options.preAddress);
  const safeAddress = getAddress(options.safeAddress);
  const deploymentBlock = BigInt(options.deploymentBlock);
  if (deploymentBlock <= 0n) throw new Error('Keyword Market deployment block must be positive');
  const { artifact, artifactSha256 } = reviewed;
  if (artifact.contractName !== 'PREKeywordMarketV1' || !artifact.buildInfoId) {
    throw new Error('Reviewed Keyword Market artifact identity is missing or invalid');
  }
  if (JSON.stringify(artifact.abi) !== JSON.stringify(PRE_KEYWORD_MARKET_ABI)) {
    throw new Error('Keyword Market generated ABI differs from the reviewed pinned artifact');
  }
  const state = await database.adIndexerState.findUnique({
    where: { key: adsIndexerStateKey({ chainId: options.chainId, contractAddress: address }) },
  });
  if (
    !state ||
    state.chainId !== options.chainId ||
    state.contractAddress.toLowerCase() !== address.toLowerCase() ||
    state.configBlockNumber !== state.lastBlockNumber ||
    state.minimumStakeRaw === null ||
    state.paused === null ||
    state.operatorAddress === null
  ) {
    throw new Error('Keyword Market projection is not fully synchronized');
  }
  const [
    chainId,
    head,
    deploymentCode,
    previousCode,
    currentCode,
    tokenCode,
    safeCode,
    pre,
    owner,
    decimals,
    minimumStake,
    paused,
    operator,
    checkpoint,
  ] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getBytecode({ address, blockNumber: deploymentBlock }),
    client.getBytecode({ address, blockNumber: deploymentBlock - 1n }),
    client.getBytecode({ address, blockNumber: state.lastBlockNumber }),
    client.getBytecode({ address: preAddress, blockNumber: state.lastBlockNumber }),
    client.getBytecode({ address: safeAddress, blockNumber: state.lastBlockNumber }),
    client.readContract({
      address,
      abi: PRE_KEYWORD_MARKET_ABI,
      functionName: 'PRE',
      blockNumber: state.lastBlockNumber,
    }),
    client.readContract({ address, abi: PRE_KEYWORD_MARKET_ABI, functionName: 'owner' }),
    client.readContract({
      address: preAddress,
      abi: erc20Abi,
      functionName: 'decimals',
      blockNumber: state.lastBlockNumber,
    }),
    client.readContract({
      address,
      abi: PRE_KEYWORD_MARKET_ABI,
      functionName: 'minimumStake',
      blockNumber: state.lastBlockNumber,
    }),
    client.readContract({
      address,
      abi: PRE_KEYWORD_MARKET_ABI,
      functionName: 'paused',
      blockNumber: state.lastBlockNumber,
    }),
    client.readContract({
      address,
      abi: PRE_KEYWORD_MARKET_ABI,
      functionName: 'operator',
      blockNumber: state.lastBlockNumber,
    }),
    client.getBlock({ blockNumber: state.lastBlockNumber }),
  ]);
  if (chainId !== options.chainId)
    throw new Error('Keyword Market RPC chain does not match the configured network');
  if (previousCode && previousCode !== '0x') {
    throw new Error('Keyword Market already exists before its configured deployment block');
  }
  if (getAddress(pre) !== preAddress || decimals !== 18 || !tokenCode || tokenCode === '0x') {
    throw new Error('Keyword Market PRE token identity or decimals do not match');
  }
  if (getAddress(owner) !== safeAddress || !safeCode || safeCode === '0x') {
    throw new Error('Keyword Market owner is not the configured deployed Safe');
  }
  const expectedRuntime = normalizedMarketRuntime(artifact.deployedBytecode, artifact);
  if (
    normalizedMarketRuntime(deploymentCode ?? '', artifact) !== expectedRuntime ||
    normalizedMarketRuntime(currentCode ?? '', artifact) !== expectedRuntime
  ) {
    throw new Error('Keyword Market runtime differs from the reviewed pinned artifact');
  }
  const finalizedHead = finalizedAdsBlock(head, options.confirmations);
  // Both supported Base networks target 2-second blocks; align lag with the API's 60-second freshness window.
  const age = (options.now?.getTime() ?? Date.now()) - state.updatedAt.getTime();
  if (
    age < 0 ||
    age > 60_000 ||
    state.lastBlockNumber < deploymentBlock ||
    state.lastBlockNumber > finalizedHead ||
    finalizedHead - state.lastBlockNumber > 30n
  ) {
    throw new Error(
      'Keyword Market projection checkpoint is stale or outside the finalized boundary',
    );
  }
  if (String(checkpoint.hash).toLowerCase() !== state.lastBlockHash.toLowerCase())
    throw new Error('Keyword Market checkpoint is not canonical');
  if (
    minimumStake <= 0n ||
    minimumStake.toString() !== state.minimumStakeRaw ||
    paused !== state.paused ||
    getAddress(operator).toLowerCase() !== state.operatorAddress.toLowerCase()
  ) {
    throw new Error('Keyword Market cached configuration does not match its checkpoint');
  }
  const expectedPaused =
    options.phase === 'preopen' ? true : options.phase === 'active' ? false : undefined;
  if (expectedPaused !== undefined) {
    const currentPaused = await client.readContract({
      address,
      abi: PRE_KEYWORD_MARKET_ABI,
      functionName: 'paused',
    });
    if (paused !== expectedPaused || currentPaused !== expectedPaused)
      throw new Error(
        `Keyword Market must be ${expectedPaused ? 'paused' : 'unpaused'} for ${options.phase}`,
      );
  }
  const canonical = await client.getBlock({ blockNumber: state.lastBlockNumber });
  if (String(canonical.hash).toLowerCase() !== state.lastBlockHash.toLowerCase())
    throw new Error('Keyword Market chain reorganized during readiness verification');
  return {
    status: 'READY' as const,
    phase: options.phase ?? (paused ? 'preopen' : 'active'),
    chainId,
    contractAddress: address.toLowerCase(),
    deploymentBlock: deploymentBlock.toString(),
    preAddress: preAddress.toLowerCase(),
    safeAddress: safeAddress.toLowerCase(),
    minimumStakeRaw: minimumStake.toString(),
    paused,
    operatorAddress: getAddress(operator).toLowerCase(),
    indexedThroughBlock: state.lastBlockNumber.toString(),
    indexedBlockHash: state.lastBlockHash.toLowerCase(),
    finalizedHead: finalizedHead.toString(),
    finalizedLagBlocks: (finalizedHead - state.lastBlockNumber).toString(),
    buildInfoId: artifact.buildInfoId,
    artifactSha256,
    abiSha256: sha256(JSON.stringify(artifact.abi)),
    runtimeSha256: sha256(Buffer.from(expectedRuntime.slice(2), 'hex')),
  };
}
