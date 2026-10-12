import {
  readLatestPreUsdPrice,
  type AdPricePublication,
  type PrismaClient,
} from '@precommunity/database';
import { keywordMarketConfirmations, type PreUsdQuote } from '@precommunity/shared';
import type { PrivateKeyAccount } from 'viem';
import { config } from './config';
import { finalizedAdsBlock } from './ads-projection';
import {
  createPricePublicationChain,
  PricePublicationBlocked,
  unlockPriceUpdater,
  type PricePublicationChain,
} from './pre-usd-price-publication-chain';
import { readKeywordMarketWalletReservation } from './keyword-market-wallet';

const inFlight = ['SIGNED', 'SUBMITTED', 'RECONCILING'];
const maxUint256 = (1n << 256n) - 1n;

export interface PricePublicationDependencies {
  chain: PricePublicationChain;
  unlock(): Promise<PrivateKeyAccount>;
  now: Date;
  chainId: number;
  contractAddress: string;
  confirmations: number;
}

let account: Promise<PrivateKeyAccount> | undefined;
function defaultDependencies(): PricePublicationDependencies | null {
  if (!config.adsContract.address) return null;
  return {
    chain: createPricePublicationChain(),
    unlock: () => {
      account ??= unlockPriceUpdater(
        config.adsPriceUpdater.keystorePath,
        config.adsPriceUpdater.password,
      ).catch((error) => {
        account = undefined;
        throw error;
      });
      return account;
    },
    now: new Date(),
    chainId: config.deployment.chainId,
    contractAddress: config.adsContract.address.toLowerCase(),
    confirmations: keywordMarketConfirmations(config.deployment.confirmations),
  };
}

function errorCode(error: unknown) {
  return error instanceof PricePublicationBlocked ? error.code : 'RPC_UNAVAILABLE';
}

export function publicationQuote(quote: PreUsdQuote | null, now: Date) {
  if (!quote || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(quote.priceUsd))
    throw new PricePublicationBlocked('PRICE_UNAVAILABLE');
  const [whole, fraction = ''] = quote.priceUsd.split('.');
  const priceE18 = BigInt(`${whole}${fraction.padEnd(18, '0')}`);
  const milliseconds = Date.parse(quote.quotedAt);
  if (
    priceE18 <= 0n ||
    priceE18 > maxUint256 ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > now.getTime() + 60_000
  )
    throw new PricePublicationBlocked('PRICE_UNAVAILABLE');
  return {
    priceE18Raw: priceE18.toString(),
    quotedAt: BigInt(Math.floor(milliseconds / 1000)),
    quoteId: quote.id,
  };
}

async function reconcilePublication(
  database: PrismaClient,
  row: AdPricePublication,
  deps: PricePublicationDependencies,
  head: bigint,
) {
  if (!row.txHash || !row.signedTransaction || row.nonce === null || !row.signerAddress)
    throw new PricePublicationBlocked('TRANSACTION_UNKNOWN');
  const receipt = await deps.chain.receipt(row.txHash);
  if (receipt) {
    if (
      receipt.blockNumber > finalizedAdsBlock(head, deps.confirmations) ||
      (await deps.chain.blockHash(receipt.blockNumber)) !== receipt.blockHash
    ) {
      await database.adPricePublication.update({
        where: { id: row.id },
        data: { status: 'RECONCILING', errorCode: 'WAITING_CONFIRMATION' },
      });
      return true;
    }
    if (receipt.reverted) {
      await database.adPricePublication.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          errorCode: 'TRANSACTION_FAILED',
          receiptBlockNumber: receipt.blockNumber,
          receiptBlockHash: receipt.blockHash,
          nextAttemptAt: new Date(deps.now.getTime() + 60_000),
        },
      });
      return false;
    }
    let status = 'CONFIRMED';
    if (!receipt.event) {
      // An exact duplicate update intentionally emits no event.
      const current = await deps.chain.price(receipt.blockNumber);
      if (current.quotedAt > row.quotedAt) status = 'SUPERSEDED';
      else if (current.quotedAt !== row.quotedAt || current.priceE18 !== BigInt(row.priceE18Raw))
        throw new PricePublicationBlocked('TRANSACTION_UNKNOWN');
    } else if (
      receipt.event.priceE18 !== BigInt(row.priceE18Raw) ||
      receipt.event.quotedAt !== row.quotedAt
    ) {
      throw new PricePublicationBlocked('TRANSACTION_UNKNOWN');
    }
    await database.adPricePublication.update({
      where: { id: row.id },
      data: {
        status,
        errorCode: null,
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        nextAttemptAt: null,
      },
    });
    return false;
  }
  const latestNonce = await deps.chain.nonce(row.signerAddress, false);
  if (latestNonce > row.nonce) {
    const current = await deps.chain.price(finalizedAdsBlock(head, deps.confirmations));
    if (current.quotedAt >= row.quotedAt) {
      await database.adPricePublication.update({
        where: { id: row.id },
        data: { status: 'SUPERSEDED', errorCode: null },
      });
      return false;
    }
    throw new PricePublicationBlocked('NONCE_CONSUMED');
  }
  if ((await deps.chain.nonce(row.signerAddress, true)) < row.nonce)
    throw new PricePublicationBlocked('NONCE_GAP');
  try {
    await deps.chain.verify();
    const authorities = await deps.chain.authorities();
    if (row.signerAddress.toLowerCase() !== authorities.updater.toLowerCase())
      throw new PricePublicationBlocked('PRICE_UPDATER_MISMATCH');
    if (row.signerAddress.toLowerCase() === authorities.operator.toLowerCase())
      throw new PricePublicationBlocked('PRICE_UPDATER_NOT_DEDICATED');
    const hash = await deps.chain.broadcast(row.signedTransaction);
    if (hash.toLowerCase() !== row.txHash.toLowerCase())
      throw new PricePublicationBlocked('TRANSACTION_UNKNOWN');
    await database.adPricePublication.update({
      where: { id: row.id },
      data: { status: 'SUBMITTED', errorCode: 'WAITING_CONFIRMATION' },
    });
  } catch (error) {
    const code = errorCode(error);
    await database.adPricePublication.update({
      where: { id: row.id },
      data: { status: 'RECONCILING', errorCode: code },
    });
    if (code !== 'TRANSACTION_UNKNOWN') throw error;
  }
  return true;
}

export async function processPreUsdPricePublication(
  database: PrismaClient,
  dependencies?: PricePublicationDependencies,
) {
  const deps = dependencies ?? defaultDependencies();
  if (!deps) return { outcome: 'BLOCKED', errorCode: 'AWAITING_CONTRACT' };
  const identity = { chainId: deps.chainId, contractAddress: deps.contractAddress.toLowerCase() };
  let active: AdPricePublication | null = null;
  try {
    const head = await deps.chain.head();
    const outstanding = await database.adPricePublication.findMany({
      where: { ...identity, status: { in: inFlight } },
      orderBy: { createdAt: 'asc' },
    });
    for (const row of outstanding) {
      active = row;
      if (await reconcilePublication(database, row, deps, head))
        return { outcome: 'WAITING_CONFIRMATION', errorCode: 'WAITING_CONFIRMATION' };
    }
    const previous = await database.adPricePublication.findFirst({
      where: {
        ...identity,
        status: { in: ['CONFIRMED', 'FAILED', 'SUPERSEDED'] },
        nonce: { not: null },
        receiptBlockNumber: { not: null },
      },
      orderBy: { receiptBlockNumber: 'desc' },
    });
    if (
      previous?.receiptBlockNumber !== null &&
      previous?.receiptBlockNumber !== undefined &&
      previous.receiptBlockHash
    ) {
      if ((await deps.chain.blockHash(previous.receiptBlockNumber)) !== previous.receiptBlockHash) {
        active = await database.adPricePublication.update({
          where: { id: previous.id },
          data: { status: 'RECONCILING', errorCode: 'WAITING_CONFIRMATION' },
        });
        if (await reconcilePublication(database, active, deps, head))
          return { outcome: 'WAITING_CONFIRMATION', errorCode: 'WAITING_CONFIRMATION' };
      }
    }
    active = null;
    const quote = publicationQuote(await readLatestPreUsdPrice(database), deps.now);
    const current = await deps.chain.price();
    if (current.quotedAt >= quote.quotedAt) {
      await database.adPricePublication.updateMany({
        where: {
          ...identity,
          quotedAt: { lte: current.quotedAt },
          status: { in: ['PREPARED', 'FAILED'] },
        },
        data: { status: 'SUPERSEDED', errorCode: null },
      });
      return { outcome: 'UNCHANGED', errorCode: null };
    }
    active = await database.adPricePublication.upsert({
      where: { chainId_contractAddress_quotedAt: { ...identity, quotedAt: quote.quotedAt } },
      create: { ...identity, ...quote },
      update: {},
    });
    if (active.nextAttemptAt && active.nextAttemptAt > deps.now)
      return { outcome: 'BLOCKED', errorCode: active.errorCode };
    await deps.chain.verify();
    const signer = await deps.unlock();
    const authorities = await deps.chain.authorities();
    if (signer.address.toLowerCase() !== authorities.updater.toLowerCase())
      throw new PricePublicationBlocked('PRICE_UPDATER_MISMATCH');
    if (signer.address.toLowerCase() === authorities.operator.toLowerCase())
      throw new PricePublicationBlocked('PRICE_UPDATER_NOT_DEDICATED');
    const signed = await database.$transaction(
      async (tx) => {
        const reservation = await readKeywordMarketWalletReservation(
          tx,
          deps.chainId,
          signer.address,
          { publicationId: active!.id },
        );
        const saved = await tx.adPricePublication.findUniqueOrThrow({ where: { id: active!.id } });
        if (inFlight.includes(saved.status)) return saved;
        if (reservation.pending) throw new PricePublicationBlocked('WAITING_CONFIRMATION');
        const pendingNonce = await deps.chain.nonce(signer.address, true);
        if (pendingNonce !== (await deps.chain.nonce(signer.address, false)))
          throw new PricePublicationBlocked('WAITING_CONFIRMATION');
        if (reservation.latestNonce !== null && pendingNonce <= reservation.latestNonce)
          throw new PricePublicationBlocked('NONCE_GAP');
        const transaction = await deps.chain.sign(saved, signer, pendingNonce);
        return tx.adPricePublication.update({
          where: { id: saved.id },
          data: {
            status: 'SIGNED',
            signerAddress: signer.address.toLowerCase(),
            nonce: pendingNonce,
            txHash: transaction.hash,
            signedTransaction: transaction.raw,
            attemptCount: { increment: 1 },
            errorCode: null,
            nextAttemptAt: null,
            receiptBlockNumber: null,
            receiptBlockHash: null,
          },
        });
      },
      { timeout: 30_000 },
    );
    // Signed bytes and nonce must survive a crash before the first RPC submission.
    active = signed;
    const waiting = await reconcilePublication(database, signed, deps, head);
    return {
      outcome: waiting ? 'WAITING_CONFIRMATION' : 'COMPLETED',
      errorCode: waiting ? 'WAITING_CONFIRMATION' : null,
    };
  } catch (error) {
    const code = errorCode(error);
    if (active)
      await database.adPricePublication.update({
        where: { id: active.id },
        data: {
          errorCode: code,
          ...(inFlight.includes(active.status) ? { status: 'RECONCILING' } : {}),
        },
      });
    return {
      outcome: code === 'WAITING_CONFIRMATION' ? 'WAITING_CONFIRMATION' : 'BLOCKED',
      errorCode: code,
    };
  }
}
