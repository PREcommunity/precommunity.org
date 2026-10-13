export const AD_CHARGE_QUEUE = 'precommunity-ad-charges';
export const AD_CHARGE_JOB = 'charge-ad-stakes';
export const AD_CHARGE_MANUAL_JOB = 'charge-ad-stakes-manual';
export const AD_CHARGE_POLL_MS = 15_000;
export const AD_CHARGE_SETTINGS_CHANGED_EVENT = 'precommunity:ad-charge-settings-changed';
export const AD_CHARGE_DEFAULTS = {
  automaticEnabled: false,
  intervalMinutes: 10,
  clickThreshold: 50,
} as const;

export function adChargeQueueName(chainId: number, contractAddress: string) {
  return `${AD_CHARGE_QUEUE}-${chainId}-${contractAddress.toLowerCase()}`;
}

export function adWalletRefreshIntervalMs(
  settings?: Pick<AdChargeSettingsInput, 'automaticEnabled' | 'intervalMinutes'> | null,
) {
  const minutes = settings?.intervalMinutes;
  return settings?.automaticEnabled === true &&
    typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= 2_147_483_647
    ? minutes * 60_000
    : AD_CHARGE_DEFAULTS.intervalMinutes * 60_000;
}

/** The bid uses six USD decimals and PRE uses eighteen; floor avoids overcharging. */
export function billPreRaw(bidUsdRaw: string, priceUsd: string): string {
  if (!/^[1-9]\d*$/.test(bidUsdRaw)) throw new Error('Invalid USD bid');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(priceUsd)) {
    throw new Error('Invalid PRE/USD price');
  }
  const [whole, fraction = ''] = priceUsd.split('.');
  const price = BigInt(`${whole}${fraction.padEnd(18, '0')}`);
  if (price <= 0n) throw new Error('Invalid PRE/USD price');
  return ((BigInt(bidUsdRaw) * 10n ** 30n) / price).toString();
}

export interface AdChargeSettingsInput {
  automaticEnabled: boolean;
  intervalMinutes: number;
  clickThreshold: number;
}

export interface AdChargeSettingsView extends AdChargeSettingsInput {
  updatedBy: string | null;
  updatedAt: string | null;
}

export type AdChargeRunState =
  'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'FAILED';
export type AdChargeBatchState =
  | 'PREPARED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'PARTIAL'
  | 'FAILED'
  | 'UNCOLLECTABLE'
  | 'RECONCILING';

export interface AdChargeBatchView {
  id: string;
  runId: string;
  chargeId: string;
  chainId: number;
  contractAddress: string;
  keywordId: string;
  keyword: string;
  stakerAddress: string;
  positionVersion: string;
  clickCount: number;
  duePreRaw: string;
  requestedPreRaw: string;
  chargedPreRaw: string | null;
  shortfallPreRaw: string | null;
  status: AdChargeBatchState;
  txHash: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdChargeRunView {
  jobId: string;
  trigger: 'MANUAL' | 'AUTO';
  status: AdChargeRunState;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  batches: AdChargeBatchView[];
}

export interface AdChargeAdminView {
  chainId: number;
  contractAddress: string | null;
  quoteStatus: 'FRESH' | 'STALE' | 'MISSING';
  settings: AdChargeSettingsView;
  readiness: {
    status: 'READY' | 'BLOCKED' | 'WORKER_UNAVAILABLE' | 'WAITING_CONFIRMATION';
    errorCode: string | null;
    signerAddress: string | null;
    operatorAddress: string | null;
    gasBalanceRaw: string | null;
    workerHeartbeatAt: string | null;
  };
  pending: {
    clicks: number;
    preRaw: string;
    usdRaw: string;
    awaitingPriceClicks: number;
    captureErrors: number;
  };
  clickTotals: {
    billableClicks: string;
    suppressedClicks: string;
    startedAt: string | null;
  };
  history: AdChargeBatchView[];
  nextCursor: string | null;
  latestRun: AdChargeRunView | null;
}

const chargeErrors: Record<string, string> = {
  AWAITING_CONTRACT: 'The Keyword Market contract is not configured.',
  WORKER_UNAVAILABLE: 'The charge worker is unavailable.',
  KEYSTORE_MISSING: 'The operator keystore is not configured or cannot be read.',
  KEYSTORE_INVALID: 'The operator keystore cannot be unlocked. Check its file and password.',
  OPERATOR_MISMATCH: 'The signing wallet is not the contract operator.',
  INSUFFICIENT_GAS: 'The operator needs more ETH to pay transaction fees.',
  RPC_UNAVAILABLE: 'The blockchain connection is unavailable.',
  INDEXER_UNAVAILABLE: 'The Keyword Market index is not synchronized.',
  PRICE_UNAVAILABLE: 'A current PRE/USD quote is unavailable. USD debt remains pending.',
  POSITION_MISSING: 'This stake is empty. The remaining debt cannot be collected.',
  POSITION_VERSION_MISMATCH: 'The original stake was closed. Its debt cannot charge a new stake.',
  INSUFFICIENT_STAKE: 'The remaining stake was charged; part of the debt could not be collected.',
  WAITING_CONFIRMATION: 'A submitted charge is waiting for blockchain confirmation.',
  TRANSACTION_FAILED: 'The charge transaction failed. Its debt remains recorded.',
  TRANSACTION_UNKNOWN: 'The submitted charge is being reconciled. Another charge will not be sent.',
  CHAIN_MISMATCH: 'The blockchain connection points to a different network.',
  CONTRACT_MISMATCH: 'The configured contract or PRE token does not match this deployment.',
  CAPTURE_FAILED: 'A click could not be billed because its bid could not be captured.',
  CAPTURE_INTERRUPTED: 'A click capture was interrupted; no later bid will be substituted.',
  QUEUE_UNAVAILABLE: 'The charge queue is unavailable.',
  REORG_DETECTED: 'The blockchain changed. The charge is being reconciled.',
  NONCE_GAP:
    'An earlier operator transaction is missing. Resolve the wallet nonce before this charge can continue.',
  CAPTURE_PROOF_ORPHANED:
    'The original click billing data was removed by a blockchain change. This batch needs review before it can be charged.',
};

export function adChargeErrorMessage(code: string | null | undefined) {
  return code
    ? (chargeErrors[code] ?? 'The charge could not be completed. Check the operator configuration.')
    : null;
}
