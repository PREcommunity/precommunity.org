export const PRE_USD_PRICE_QUEUE = 'precommunity-pre-usd-prices';
export const PRE_USD_PRICE_JOB = 'fetch-pre-usd-price';
export const PRE_USD_PRICE_MANUAL_JOB = 'refresh-pre-usd-price';
export const PRE_USD_PRICE_POLL_MS = 10 * 60_000;
export const PRE_USD_PRICE_MAX_AGE_MS = 30 * 60_000;
export const PRE_USD_PRICE_COOLDOWN_MS = 60_000;
export const PRE_USD_PRICE_PUBLICATION_JOB = 'publish-pre-usd-price';
export const PRE_USD_PRICE_PUBLICATION_POLL_MS = 15_000;

export function preUsdPricePublicationQueueName(chainId: number, contractAddress: string) {
  return `precommunity-pre-usd-publication-${chainId}-${contractAddress.toLowerCase()}`;
}

export interface PreUsdQuote {
  id: string;
  source: 'COINGECKO';
  assetId: 'presearch';
  priceUsd: string;
  quotedAt: string;
  fetchedAt: string;
}

export interface PreUsdPriceSnapshot {
  status: 'FRESH' | 'STALE' | 'MISSING';
  quote: PreUsdQuote | null;
}

export interface PreUsdPriceAdminView extends PreUsdPriceSnapshot {
  collectorEnabled: boolean;
  walletRefreshIntervalMs: number;
  contract?: {
    chainId: number;
    address: string | null;
    priceUsd: string | null;
    quotedAt: string | null;
    status: 'FRESH' | 'STALE' | 'MISSING' | 'SYNCING' | 'AWAITING_CONTRACT';
    updaterAddress: string | null;
    updaterGasBalanceRaw: string | null;
    publication: {
      status: string;
      txHash: string | null;
      errorCode: string | null;
      quotedAt: string;
    } | null;
  };
}

export interface PreUsdPriceRefreshResult {
  outcome: 'UPDATED' | 'UNCHANGED' | 'COOLDOWN';
  retryAt?: string;
}

export interface PreUsdPriceRefreshStatus {
  jobId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  result: PreUsdPriceRefreshResult | null;
}

export function preUsdPriceSnapshot(
  quote: PreUsdQuote | null,
  now = new Date(),
): PreUsdPriceSnapshot {
  if (!quote) return { status: 'MISSING', quote: null };
  const age = now.getTime() - Date.parse(quote.quotedAt);
  return {
    status:
      Number.isFinite(age) && age >= -60_000 && age <= PRE_USD_PRICE_MAX_AGE_MS ? 'FRESH' : 'STALE',
    quote,
  };
}

export function usablePreUsdQuote(snapshot: PreUsdPriceSnapshot): PreUsdQuote | null {
  return snapshot.status === 'FRESH' ? snapshot.quote : null;
}

export function preUsdPublicationErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    AWAITING_CONTRACT: 'The Keyword Market contract is not configured.',
    PRICE_UNAVAILABLE: 'No valid PRE/USD quotation is available to publish.',
    KEYSTORE_MISSING: 'The price updater keystore is not configured or cannot be read.',
    KEYSTORE_INVALID: 'The price updater keystore could not be unlocked.',
    PRICE_UPDATER_MISMATCH: 'The price updater wallet is not authorized by the contract.',
    PRICE_UPDATER_NOT_DEDICATED: 'Use a separate wallet for price updates and click settlement.',
    INSUFFICIENT_GAS: 'The price updater needs ETH for gas.',
    RPC_UNAVAILABLE: 'The blockchain connection is unavailable. Publication will retry.',
    CHAIN_MISMATCH: 'The blockchain connection points to a different network.',
    CONTRACT_MISMATCH: 'The configured contract does not match the reviewed deployment.',
    WAITING_CONFIRMATION: 'The price transaction is waiting for confirmations.',
    TRANSACTION_FAILED: 'The price transaction failed. The last contract price remains in use.',
    TRANSACTION_UNKNOWN: 'The price transaction is being reconciled before another is sent.',
    NONCE_GAP: 'An earlier price updater transaction needs operator attention.',
    NONCE_CONSUMED:
      'The price updater nonce was used by another transaction. Operator attention is required.',
  };
  return messages[code] ?? 'Price publication needs operator attention.';
}
