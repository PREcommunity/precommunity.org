import {
  Prisma,
  type AdBillingClick,
  type AdChargeBatch,
  type AdChargeRun,
  type AdChargeSettings,
  type PrismaClient,
} from '@precommunity/database';
import {
  adWalletRefreshIntervalMs,
  billPreRaw,
  keywordMarketConfirmations,
} from '@precommunity/shared';
import { randomBytes } from 'node:crypto';
import { formatUnits, type PrivateKeyAccount } from 'viem';
import { config } from './config';
import {
  ChargeBlocked,
  createChargeChain,
  unlockChargeOperator,
  type ChargeChain,
  type ChargeReceipt,
} from './keyword-market-charges-chain';
import { readKeywordMarketWalletReservation } from './keyword-market-wallet';

const terminal = ['CONFIRMED', 'PARTIAL', 'UNCOLLECTABLE'];
const inFlight = ['SIGNED', 'SUBMITTED', 'RECONCILING'];
const recoverableRuns = ['QUEUED', 'RUNNING', 'BLOCKED'];
const maxUint256 = (1n << 256n) - 1n;

export interface ChargeDependencies {
  chain: ChargeChain;
  unlock: () => Promise<PrivateKeyAccount>;
  now: Date;
  chainId: number;
  contractAddress: string;
  confirmations: number;
}

let account: Promise<PrivateKeyAccount> | undefined;
// Keep per-pass chains fresh for canonical hash checks; only the display balance is cached.
const defaultWalletBalanceCacheKey = {};
const walletBalanceCache = new WeakMap<
  object,
  { address: string; balance: string; checkedAt: number }
>();
function defaultDependencies(): ChargeDependencies | null {
  if (!config.adsContract.address) return null;
  return {
    chain: createChargeChain(),
    unlock: () => {
      account ??= unlockChargeOperator(
        config.adsOperator.keystorePath,
        config.adsOperator.password,
      ).catch((error) => {
        account = undefined;
        throw error;
      });
      return account;
    },
    now: new Date(),
    chainId: config.deployment.chainId,
    contractAddress: config.adsContract.address,
    confirmations: keywordMarketConfirmations(config.deployment.confirmations),
  };
}

function code(error: unknown) {
  return error instanceof ChargeBlocked ? error.code : 'RPC_UNAVAILABLE';
}

export function chargeGroupDue(
  clicks: Pick<AdBillingClick, 'clickedAt'>[],
  settings: Pick<AdChargeSettings, 'intervalMinutes' | 'clickThreshold'>,
  now: Date,
) {
  const oldest = clicks.reduce(
    (time, click) => Math.min(time, click.clickedAt.getTime()),
    Infinity,
  );
  return (
    clicks.length >= settings.clickThreshold ||
    (clicks.length > 0 && now.getTime() - oldest >= settings.intervalMinutes * 60_000)
  );
}

function groups(clicks: AdBillingClick[]) {
  const result = new Map<string, AdBillingClick[]>();
  for (const click of clicks) {
    const key = `${click.keywordId}:${click.stakerAddress}:${click.positionVersion}`;
    const group = result.get(key) ?? [];
    group.push(click);
    result.set(key, group);
  }
  return [...result.values()];
}

async function convertPendingPrices(
  database: PrismaClient,
  identity: { chainId: number; contractAddress: string },
  now: Date,
) {
  await database.adBillingClick.updateMany({
    where: {
      ...identity,
      status: 'CAPTURING',
      clickedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
    },
    data: { status: 'UNBILLED', errorCode: 'CAPTURE_INTERRUPTED' },
  });
  const snapshot = await database.adIndexerState.findUnique({
    where: { key: `${identity.chainId}:${identity.contractAddress.toLowerCase()}` },
  });
  if (
    !snapshot ||
    snapshot.configBlockNumber !== snapshot.lastBlockNumber ||
    now.getTime() - snapshot.updatedAt.getTime() < 0 ||
    now.getTime() - snapshot.updatedAt.getTime() > 60_000 ||
    !snapshot.preUsdPriceE18Raw ||
    BigInt(snapshot.preUsdPriceE18Raw) <= 0n ||
    !snapshot.preUsdPriceQuotedAt ||
    snapshot.preUsdPriceQuotedAt <= 0n
  )
    return;
  const priceUsd = formatUnits(BigInt(snapshot.preUsdPriceE18Raw), 18);
  const quotedAt = new Date(Number(snapshot.preUsdPriceQuotedAt) * 1_000);
  let after: string | undefined;
  while (true) {
    const clicks = await database.adBillingClick.findMany({
      where: {
        ...identity,
        status: 'PRICE_PENDING',
        amountPreRaw: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 500,
    });
    for (const click of clicks) {
      if (!click.bidUsdRaw) continue;
      await database.adBillingClick.updateMany({
        where: { id: click.id, status: 'PRICE_PENDING', amountPreRaw: null },
        data: {
          status: billPreRaw(click.bidUsdRaw, priceUsd) === '0' ? 'SETTLED' : 'PENDING',
          amountPreRaw: billPreRaw(click.bidUsdRaw, priceUsd),
          priceQuoteId: null,
          priceUsd,
          priceQuotedAt: quotedAt,
          priceBlockNumber: snapshot.lastBlockNumber,
          priceBlockHash: snapshot.lastBlockHash,
          errorCode: null,
        },
      });
    }
    if (clicks.length < 500) break;
    after = clicks.at(-1)!.id;
  }
}

async function validateClickEvidence(
  database: PrismaClient,
  deps: ChargeDependencies,
  finalizedBlock: bigint,
) {
  const clicks = await database.adBillingClick.findMany({
    where: {
      chainId: deps.chainId,
      contractAddress: deps.contractAddress,
      status: { in: ['PENDING', 'PRICE_PENDING'] },
      batchId: null,
    },
  });
  for (const click of clicks) {
    let errorCode: string | null = null;
    if (click.bidBlockNumber === null || !click.bidBlockHash) errorCode = 'CAPTURE_FAILED';
    else if (click.bidBlockNumber > finalizedBlock) continue;
    else if (
      (await deps.chain.blockHash(click.bidBlockNumber)) !== click.bidBlockHash.toLowerCase()
    )
      errorCode = 'REORG_DETECTED';
    if (!errorCode && click.priceBlockNumber !== null && click.priceBlockNumber !== undefined) {
      if (!click.priceBlockHash) errorCode = 'CAPTURE_FAILED';
      else if (click.priceBlockNumber > finalizedBlock) continue;
      else if (
        (await deps.chain.blockHash(click.priceBlockNumber)) !== click.priceBlockHash.toLowerCase()
      )
        errorCode = 'REORG_DETECTED';
    }
    if (errorCode)
      await database.adBillingClick.updateMany({
        where: { id: click.id, batchId: null, status: { in: ['PENDING', 'PRICE_PENDING'] } },
        data: { status: 'UNBILLED', errorCode },
      });
  }
}

async function reserveRun(
  database: PrismaClient,
  run: AdChargeRun,
  settings: AdChargeSettings,
  deps: ChargeDependencies,
  head: bigint,
) {
  const transferredRuns = await database.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ad-charge:${deps.chainId}:${deps.contractAddress}`}, 0))`,
    );
    const current = await tx.adChargeRun.findUniqueOrThrow({ where: { id: run.id } });
    const autoRuns =
      run.trigger === 'MANUAL'
        ? await tx.adChargeRun.findMany({
            where: {
              chainId: deps.chainId,
              contractAddress: deps.contractAddress,
              trigger: 'AUTO',
              status: { in: recoverableRuns },
            },
          })
        : [];
    if (autoRuns.length)
      await tx.adChargeBatch.updateMany({
        where: {
          runId: { in: autoRuns.map((row) => row.id) },
          status: { in: ['PREPARED', 'FAILED'] },
        },
        data: { runId: run.id },
      });
    const cutoff = current.startedAt ?? deps.now;
    const finalizedBlock =
      head >= BigInt(deps.confirmations) ? head - BigInt(deps.confirmations) : 0n;
    const clicks = await tx.adBillingClick.findMany({
      where: {
        chainId: deps.chainId,
        contractAddress: deps.contractAddress,
        status: 'PENDING',
        batchId: null,
        clickedAt: { lte: cutoff },
        bidBlockNumber: { lte: finalizedBlock },
      },
      orderBy: [{ clickedAt: 'asc' }, { id: 'asc' }],
    });
    for (const clickGroup of groups(clicks)) {
      if (run.trigger !== 'MANUAL' && !chargeGroupDue(clickGroup, settings, deps.now)) continue;
      const first = clickGroup[0]!;
      const due = clickGroup.reduce((sum, click) => sum + BigInt(click.amountPreRaw!), 0n);
      const batch = await tx.adChargeBatch.create({
        data: {
          runId: run.id,
          chargeId: `0x${randomBytes(32).toString('hex')}`,
          chainId: deps.chainId,
          contractAddress: deps.contractAddress,
          keywordId: first.keywordId,
          keyword: first.keyword,
          stakerAddress: first.stakerAddress,
          positionVersion: first.positionVersion,
          clickCount: clickGroup.length,
          duePreRaw: due.toString(),
          requestedPreRaw: (due > maxUint256 ? maxUint256 : due).toString(),
          ...(due === 0n ? { status: 'CONFIRMED', chargedPreRaw: '0', shortfallPreRaw: '0' } : {}),
        },
      });
      const reserved = await tx.adBillingClick.updateMany({
        where: {
          id: { in: clickGroup.map((click) => click.id) },
          status: 'PENDING',
          batchId: null,
        },
        data: { batchId: batch.id, status: due === 0n ? 'SETTLED' : 'RESERVED' },
      });
      if (reserved.count !== clickGroup.length) throw new ChargeBlocked('TRANSACTION_UNKNOWN');
    }
    await tx.adChargeRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', startedAt: cutoff, errorCode: null },
    });
    return autoRuns.map((row) => row.id);
  });
  for (const runId of transferredRuns) await refreshRun(database, runId, deps.now);
}

export async function settleChargeReceipt(
  database: PrismaClient,
  batch: AdChargeBatch,
  receipt: ChargeReceipt,
) {
  const event = receipt.event;
  if (
    !event ||
    event.keywordId.toLowerCase() !== batch.keywordId ||
    event.staker.toLowerCase() !== batch.stakerAddress ||
    event.chargeId.toLowerCase() !== batch.chargeId ||
    event.requestedPre.toString() !== batch.requestedPreRaw ||
    event.chargedPre < 0n ||
    event.chargedPre > BigInt(batch.requestedPreRaw)
  ) {
    throw new ChargeBlocked('TRANSACTION_UNKNOWN');
  }
  const shortfall = BigInt(batch.duePreRaw) - event.chargedPre;
  await database.$transaction(async (tx) => {
    await tx.adChargeBatch.update({
      where: { id: batch.id },
      data: {
        status: shortfall > 0n ? 'PARTIAL' : 'CONFIRMED',
        chargedPreRaw: event.chargedPre.toString(),
        shortfallPreRaw: shortfall.toString(),
        settledTxHash: receipt.transactionHash ?? batch.txHash,
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        errorCode: shortfall > 0n ? 'INSUFFICIENT_STAKE' : null,
        nextAttemptAt: null,
      },
    });
    const clicks = await tx.adBillingClick.findMany({
      where: { batchId: batch.id },
      orderBy: [{ clickedAt: 'asc' }, { id: 'asc' }],
    });
    let available = event.chargedPre;
    const settled: string[] = [];
    const uncollectable: string[] = [];
    for (const click of clicks) {
      const due = BigInt(click.amountPreRaw!);
      (available >= due ? settled : uncollectable).push(click.id);
      available = available >= due ? available - due : 0n;
    }
    if (settled.length)
      await tx.adBillingClick.updateMany({
        where: { id: { in: settled } },
        data: { status: 'SETTLED', errorCode: null },
      });
    if (uncollectable.length)
      await tx.adBillingClick.updateMany({
        where: { id: { in: uncollectable } },
        data: { status: 'UNCOLLECTABLE', errorCode: 'INSUFFICIENT_STAKE' },
      });
  });
}

async function uncollectable(
  database: PrismaClient,
  batch: AdChargeBatch,
  errorCode: string,
  blockNumber: bigint,
  blockHash: string,
) {
  await database.$transaction(async (tx) => {
    await tx.adChargeBatch.update({
      where: { id: batch.id },
      data: {
        status: 'UNCOLLECTABLE',
        chargedPreRaw: '0',
        shortfallPreRaw: batch.duePreRaw,
        receiptBlockNumber: blockNumber,
        receiptBlockHash: blockHash,
        errorCode,
      },
    });
    await tx.adBillingClick.updateMany({
      where: { batchId: batch.id },
      data: { status: 'UNCOLLECTABLE', errorCode },
    });
  });
}

async function assertBatchCapture(
  database: PrismaClient,
  batch: AdChargeBatch,
  deps: ChargeDependencies,
  head: bigint,
) {
  const finalizedBlock =
    head >= BigInt(deps.confirmations) ? head - BigInt(deps.confirmations) : 0n;
  const clicks = await database.adBillingClick.findMany({ where: { batchId: batch.id } });
  for (const click of clicks) {
    if (click.bidBlockNumber === null || !click.bidBlockHash)
      throw new ChargeBlocked('CAPTURE_FAILED');
    if (click.bidBlockNumber > finalizedBlock) throw new ChargeBlocked('WAITING_CONFIRMATION');
    if ((await deps.chain.blockHash(click.bidBlockNumber)) !== click.bidBlockHash.toLowerCase())
      throw new ChargeBlocked('CAPTURE_PROOF_ORPHANED');
    if (click.priceBlockNumber !== null && click.priceBlockNumber !== undefined) {
      if (!click.priceBlockHash) throw new ChargeBlocked('CAPTURE_FAILED');
      if (click.priceBlockNumber > finalizedBlock) throw new ChargeBlocked('WAITING_CONFIRMATION');
      if (
        (await deps.chain.blockHash(click.priceBlockNumber)) !== click.priceBlockHash.toLowerCase()
      )
        throw new ChargeBlocked('CAPTURE_PROOF_ORPHANED');
    }
  }
}

async function settleIndexedCharge(
  database: PrismaClient,
  batch: AdChargeBatch,
  deps: ChargeDependencies,
  head: bigint,
) {
  const indexed = await database.adChainEvent.findFirst({
    where: {
      chainId: batch.chainId,
      contractAddress: batch.contractAddress,
      eventName: 'StakeCharged',
      payload: { path: ['chargeId'], equals: batch.chargeId },
    },
    orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }],
  });
  if (
    !indexed ||
    head < indexed.blockNumber + BigInt(deps.confirmations) ||
    (await deps.chain.blockHash(indexed.blockNumber)) !== indexed.blockHash.toLowerCase()
  )
    return false;
  const payload = indexed.payload as Record<string, unknown>;
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.chargeId !== 'string' ||
    typeof payload.keywordId !== 'string' ||
    typeof payload.staker !== 'string' ||
    typeof payload.requestedPre !== 'string' ||
    !/^\d+$/.test(payload.requestedPre) ||
    typeof payload.chargedPre !== 'string' ||
    !/^\d+$/.test(payload.chargedPre)
  )
    throw new ChargeBlocked('TRANSACTION_UNKNOWN');
  await settleChargeReceipt(database, batch, {
    transactionHash: indexed.txHash,
    blockNumber: indexed.blockNumber,
    blockHash: indexed.blockHash.toLowerCase(),
    reverted: false,
    event: {
      chargeId: payload.chargeId,
      keywordId: payload.keywordId,
      staker: payload.staker,
      requestedPre: BigInt(payload.requestedPre),
      chargedPre: BigInt(payload.chargedPre),
    },
  });
  return true;
}

export async function reconcileChargeBatch(
  database: PrismaClient,
  batch: AdChargeBatch,
  deps: ChargeDependencies,
  head: bigint,
) {
  const signed = Boolean(batch.txHash && batch.signedTransaction);
  if (
    terminal.includes(batch.status) &&
    batch.receiptBlockNumber !== null &&
    batch.receiptBlockHash
  ) {
    if (
      (await deps.chain.blockHash(batch.receiptBlockNumber)) ===
      batch.receiptBlockHash.toLowerCase()
    )
      return false;
    await database.$transaction(async (tx) => {
      await tx.adChargeBatch.update({
        where: { id: batch.id },
        data: {
          status: signed ? 'RECONCILING' : 'PREPARED',
          chargedPreRaw: null,
          shortfallPreRaw: null,
          settledTxHash: null,
          receiptBlockNumber: null,
          receiptBlockHash: null,
          errorCode: 'REORG_DETECTED',
        },
      });
      await tx.adBillingClick.updateMany({
        where: { batchId: batch.id },
        data: { status: 'RESERVED', errorCode: 'REORG_DETECTED' },
      });
      await tx.adChargeRun.update({
        where: { id: batch.runId },
        data: { status: 'RUNNING', finishedAt: null, errorCode: 'REORG_DETECTED' },
      });
    });
  }
  if (!batch.txHash || !batch.signedTransaction) return false;
  const receipt = await deps.chain.receipt(batch.txHash, batch.chargeId);
  if (receipt) {
    if (
      head < receipt.blockNumber + BigInt(deps.confirmations) ||
      (await deps.chain.blockHash(receipt.blockNumber)) !== receipt.blockHash
    ) {
      await database.adChargeBatch.update({
        where: { id: batch.id },
        data: { status: 'RECONCILING', errorCode: 'WAITING_CONFIRMATION' },
      });
      return true;
    }
    if (receipt.reverted) {
      if (batch.status === 'FAILED' && batch.receiptBlockHash === receipt.blockHash) return false;
      await database.adChargeBatch.update({
        where: { id: batch.id },
        data: {
          status: 'FAILED',
          receiptBlockNumber: receipt.blockNumber,
          receiptBlockHash: receipt.blockHash,
          errorCode: 'TRANSACTION_FAILED',
          nextAttemptAt: new Date(deps.now.getTime() + 60_000),
        },
      });
      return false;
    }
    if (!receipt.event) {
      if (await settleIndexedCharge(database, batch, deps, head)) return false;
      await database.adChargeBatch.update({
        where: { id: batch.id },
        data: { status: 'RECONCILING', errorCode: 'TRANSACTION_UNKNOWN' },
      });
      return true;
    }
    await settleChargeReceipt(database, batch, receipt);
    return false;
  }
  if (await deps.chain.processed(batch.chargeId)) {
    if (await settleIndexedCharge(database, batch, deps, head)) return false;
    await database.adChargeBatch.update({
      where: { id: batch.id },
      data: { status: 'RECONCILING', errorCode: 'TRANSACTION_UNKNOWN' },
    });
    return true;
  }
  if (batch.nonce !== null && batch.signerAddress) {
    const pendingNonce = await deps.chain.pendingNonce(batch.signerAddress);
    if (pendingNonce < batch.nonce) {
      const predecessor = await database.adChargeBatch.findFirst({
        where: {
          chainId: batch.chainId,
          signerAddress: batch.signerAddress,
          nonce: pendingNonce,
          status: { in: inFlight },
          id: { not: batch.id },
        },
      });
      const errorCode = predecessor ? 'WAITING_CONFIRMATION' : 'NONCE_GAP';
      await database.adChargeBatch.update({
        where: { id: batch.id },
        data: { status: 'RECONCILING', errorCode },
      });
      if (!predecessor) throw new ChargeBlocked(errorCode);
      return true;
    }
  }
  try {
    await assertBatchCapture(database, batch, deps, head);
  } catch (error) {
    const errorCode = code(error);
    await database.adChargeBatch.update({
      where: { id: batch.id },
      data: { status: 'RECONCILING', errorCode },
    });
    if (errorCode === 'WAITING_CONFIRMATION') return true;
    // A signed orphan owns a nonce; operator reconciliation is required before new sends.
    throw error;
  }
  try {
    const hash = await deps.chain.broadcast(batch.signedTransaction);
    if (hash.toLowerCase() !== batch.txHash.toLowerCase())
      throw new ChargeBlocked('TRANSACTION_UNKNOWN');
    await database.adChargeBatch.update({
      where: { id: batch.id },
      data: { status: 'SUBMITTED', errorCode: 'WAITING_CONFIRMATION' },
    });
  } catch (error) {
    // An RPC timeout after acceptance is unresolved, never a reason to charge again.
    await database.adChargeBatch.update({
      where: { id: batch.id },
      data: {
        status: 'RECONCILING',
        errorCode:
          error instanceof ChargeBlocked && error.code === 'INSUFFICIENT_GAS'
            ? error.code
            : 'TRANSACTION_UNKNOWN',
      },
    });
    if (error instanceof ChargeBlocked && error.code === 'INSUFFICIENT_GAS') throw error;
  }
  return true;
}

async function prepareBatch(
  database: PrismaClient,
  batch: AdChargeBatch,
  deps: ChargeDependencies,
  signer: PrivateKeyAccount,
  head: bigint,
) {
  const finalizedBlock =
    head >= BigInt(deps.confirmations) ? head - BigInt(deps.confirmations) : 0n;
  await assertBatchCapture(database, batch, deps, head);
  const finalized = await deps.chain.position(batch, finalizedBlock);
  if (finalized.positionVersion !== batch.positionVersion) {
    await uncollectable(
      database,
      batch,
      'POSITION_VERSION_MISMATCH',
      finalizedBlock,
      await deps.chain.blockHash(finalizedBlock),
    );
    return false;
  }
  if (finalized.amount === 0n) {
    await uncollectable(
      database,
      batch,
      'POSITION_MISSING',
      finalizedBlock,
      await deps.chain.blockHash(finalizedBlock),
    );
    return false;
  }
  const current = await deps.chain.position(batch);
  if (current.positionVersion !== batch.positionVersion || current.amount === 0n)
    throw new ChargeBlocked('WAITING_CONFIRMATION');
  if (await deps.chain.processed(batch.chargeId)) throw new ChargeBlocked('TRANSACTION_UNKNOWN');
  const signed = await database.$transaction(
    async (tx) => {
      const reservation = await readKeywordMarketWalletReservation(
        tx,
        deps.chainId,
        signer.address,
        { chargeId: batch.id },
      );
      const saved = await tx.adChargeBatch.findUniqueOrThrow({ where: { id: batch.id } });
      if (inFlight.includes(saved.status)) return saved;
      if (terminal.includes(saved.status)) return null;
      if (reservation.pending) throw new ChargeBlocked('WAITING_CONFIRMATION');
      const pendingNonce = await deps.chain.pendingNonce(signer.address);
      if (reservation.latestNonce !== null && pendingNonce <= reservation.latestNonce)
        throw new ChargeBlocked('NONCE_GAP');
      const nonce = pendingNonce;
      const transaction = await deps.chain.sign(saved, signer, nonce);
      return tx.adChargeBatch.update({
        where: { id: batch.id },
        data: {
          status: 'SIGNED',
          signerAddress: signer.address.toLowerCase(),
          nonce,
          txHash: transaction.hash,
          signedTransaction: transaction.raw,
          errorCode: null,
          attemptCount: { increment: 1 },
          nextAttemptAt: null,
          receiptBlockNumber: null,
          receiptBlockHash: null,
        },
      });
    },
    { timeout: 30_000 },
  );
  // The database commits the signed bytes and nonce before the first broadcast.
  return signed ? reconcileChargeBatch(database, signed, deps, head) : false;
}

async function refreshRun(database: PrismaClient, runId: string, now: Date, failure?: string) {
  const run = await database.adChargeRun.findUniqueOrThrow({ where: { id: runId } });
  const batches = await database.adChargeBatch.findMany({ where: { runId } });
  const awaiting =
    run.trigger === 'MANUAL' && run.startedAt
      ? await database.adBillingClick.findMany({
          where: {
            chainId: run.chainId,
            contractAddress: run.contractAddress,
            clickedAt: { lte: run.startedAt },
            batchId: null,
            status: { in: ['PENDING', 'PRICE_PENDING'] },
          },
        })
      : [];
  if (!failure && awaiting.some((click) => click.status === 'PRICE_PENDING'))
    failure = 'PRICE_UNAVAILABLE';
  const pending = awaiting.length > 0 || batches.some((batch) => !terminal.includes(batch.status));
  const partial = batches.some(
    (batch) => batch.status === 'PARTIAL' || batch.status === 'UNCOLLECTABLE',
  );
  const errorCode = failure ?? batches.find((batch) => batch.errorCode)?.errorCode ?? null;
  await database.adChargeRun.update({
    where: { id: runId },
    data: {
      status:
        pending || failure
          ? failure && failure !== 'WAITING_CONFIRMATION'
            ? 'BLOCKED'
            : 'RUNNING'
          : partial
            ? 'PARTIAL'
            : 'COMPLETED',
      errorCode: pending || failure ? errorCode : partial ? errorCode : null,
      finishedAt: pending || failure ? null : now,
    },
  });
}

export async function processAdChargeJob(
  database: PrismaClient,
  job: { runId?: string } = {},
  dependencies?: ChargeDependencies,
) {
  const deps = dependencies ?? defaultDependencies();
  if (!deps) return { outcome: 'AWAITING_CONTRACT' };
  const identity = { chainId: deps.chainId, contractAddress: deps.contractAddress.toLowerCase() };
  deps.contractAddress = identity.contractAddress;
  const settingsKey = { chainId_contractAddress: identity };
  let settings = await database.adChargeSettings.upsert({
    where: settingsKey,
    create: identity,
    update: {},
  });
  await convertPendingPrices(database, identity, deps.now);
  let signer: PrivateKeyAccount | null = null;
  let operator: string | null = null;
  let balance: string | null = null;
  let blocked: string | null = null;
  let waiting = false;
  let head = 0n;
  let reconciliationCheckpoint:
    { reconciliationBlockNumber: bigint; reconciliationBlockHash: string } | undefined;
  const reconciledRuns = new Set<string>();
  try {
    head = await deps.chain.head();
    const finalizedBlock =
      head >= BigInt(deps.confirmations) ? head - BigInt(deps.confirmations) : 0n;
    const finalizedHash = await deps.chain.blockHash(finalizedBlock);
    const previousCanonical =
      settings.reconciliationBlockNumber !== null &&
      settings.reconciliationBlockHash !== null &&
      settings.reconciliationBlockNumber <= finalizedBlock &&
      (await deps.chain.blockHash(settings.reconciliationBlockNumber)) ===
        settings.reconciliationBlockHash.toLowerCase();
    await validateClickEvidence(database, deps, finalizedBlock);
    const batches = await database.adChargeBatch.findMany({
      where: {
        ...identity,
        OR: [
          { status: { in: [...inFlight, 'FAILED'] } },
          {
            status: { in: terminal },
            ...(previousCanonical
              ? {
                  OR: [
                    { receiptBlockNumber: { gt: settings.reconciliationBlockNumber! } },
                    { receiptBlockNumber: null },
                  ],
                }
              : {}),
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const batch of batches) {
      waiting = (await reconcileChargeBatch(database, batch, deps, head)) || waiting;
      reconciledRuns.add(batch.runId);
    }
    // Checkpoint the hash read before the pass; a concurrent reorg is detected next tick.
    reconciliationCheckpoint = {
      reconciliationBlockNumber: finalizedBlock,
      reconciliationBlockHash: finalizedHash,
    };
  } catch (error) {
    blocked = code(error);
  }
  if (!blocked) {
    try {
      await deps.chain.verify(database);
      signer = await deps.unlock();
      operator = (await deps.chain.operator()).toLowerCase();
      if (signer.address.toLowerCase() !== operator) throw new ChargeBlocked('OPERATOR_MISMATCH');
      const cacheKey = dependencies?.chain ?? defaultWalletBalanceCacheKey;
      const cached = walletBalanceCache.get(cacheKey);
      const age = cached ? deps.now.getTime() - cached.checkedAt : Infinity;
      if (
        !job.runId &&
        cached?.address === signer.address.toLowerCase() &&
        cached.balance !== '0' &&
        age >= 0 &&
        age < adWalletRefreshIntervalMs(settings)
      ) {
        balance = cached.balance;
      } else {
        balance = (await deps.chain.balance(signer.address)).toString();
        walletBalanceCache.set(cacheKey, {
          address: signer.address.toLowerCase(),
          balance,
          checkedAt: deps.now.getTime(),
        });
      }
      if (balance === '0') throw new ChargeBlocked('INSUFFICIENT_GAS');
    } catch (error) {
      blocked = code(error);
    }
  }
  settings = await database.adChargeSettings.update({
    where: settingsKey,
    data: {
      ...reconciliationCheckpoint,
      workerHeartbeatAt: deps.now,
      signerAddress: signer?.address.toLowerCase() ?? null,
      operatorAddress: operator,
      gasBalanceRaw: balance,
      readiness: blocked ? 'BLOCKED' : waiting ? 'WAITING_CONFIRMATION' : 'READY',
      errorCode: blocked ?? (waiting ? 'WAITING_CONFIRMATION' : null),
    },
  });
  for (const runId of reconciledRuns) await refreshRun(database, runId, deps.now);
  let runs = await database.adChargeRun.findMany({
    where: {
      ...identity,
      status: { in: recoverableRuns },
      ...(job.runId ? { id: job.runId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
  if (
    !job.runId &&
    settings.automaticEnabled &&
    !blocked &&
    !runs.some((run) => run.trigger === 'AUTO' && run.errorCode !== 'CAPTURE_PROOF_ORPHANED')
  ) {
    const clicks = await database.adBillingClick.findMany({
      where: { ...identity, status: 'PENDING', batchId: null },
      orderBy: { clickedAt: 'asc' },
    });
    if (groups(clicks).some((group) => chargeGroupDue(group, settings, deps.now))) {
      const run = await database.adChargeRun.create({ data: { ...identity, trigger: 'AUTO' } });
      runs = [...runs, run];
    }
  }
  for (const run of runs) {
    if (run.trigger === 'AUTO' && !settings.automaticEnabled) continue;
    if (blocked || !signer) {
      await database.adChargeRun.update({
        where: { id: run.id },
        data: { status: 'BLOCKED', errorCode: blocked ?? 'KEYSTORE_INVALID' },
      });
      continue;
    }
    await reserveRun(database, run, settings, deps, head);
    const batches = await database.adChargeBatch.findMany({
      where: { runId: run.id, status: { in: ['PREPARED', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
    });
    let failure: string | undefined;
    for (const batch of batches) {
      if (batch.nextAttemptAt && batch.nextAttemptAt > deps.now) continue;
      // A setting change between queued work and signing must stop automatic sends.
      if (
        run.trigger === 'AUTO' &&
        !(await database.adChargeSettings.findUniqueOrThrow({ where: settingsKey }))
          .automaticEnabled
      )
        break;
      try {
        waiting = (await prepareBatch(database, batch, deps, signer, head)) || waiting;
        if (waiting) break;
      } catch (error) {
        failure = code(error);
        await database.adChargeBatch.update({
          where: { id: batch.id },
          data: { errorCode: failure },
        });
        if (failure === 'CAPTURE_PROOF_ORPHANED') continue;
        break;
      }
    }
    await refreshRun(database, run.id, deps.now, failure);
    if (failure && failure !== 'WAITING_CONFIRMATION' && failure !== 'CAPTURE_PROOF_ORPHANED')
      blocked = failure;
  }
  if (waiting || blocked)
    await database.adChargeSettings.update({
      where: settingsKey,
      data: {
        readiness: blocked ? 'BLOCKED' : 'WAITING_CONFIRMATION',
        errorCode: blocked ?? 'WAITING_CONFIRMATION',
      },
    });
  return {
    outcome: blocked ? 'BLOCKED' : waiting ? 'WAITING_CONFIRMATION' : 'COMPLETED',
    errorCode: blocked,
  };
}
