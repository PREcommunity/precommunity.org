import { Injectable } from '@nestjs/common';
import type { AdsChainStatus } from '@precommunity/shared';
import { config } from '../config';

export const ADS_CHAIN_ADAPTER = Symbol('ADS_CHAIN_ADAPTER');

export interface AdsChainSnapshot {
  status: AdsChainStatus;
  chainId: number;
  contractAddress: string | null;
  deploymentBlock: string | null;
  transactionsEnabled: boolean;
}

export interface AdsChainPositionQuery {
  canonicalKeyword: string;
  stakerAddress: string;
}

export interface AdsChainPositionState extends AdsChainPositionQuery {
  stakeRaw: string;
  active: boolean;
}

export type AdsStakeOperation = 'CREATE_STAKE' | 'INCREASE_STAKE' | 'UNSTAKE';

export interface AdsStakeOperationInput extends AdsChainPositionQuery {
  amountRaw?: string;
}

export interface AdsPreparedTransaction {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  valueRaw: string;
}

export interface AdsDisabledStakeTransactionPlan {
  status: 'AWAITING_CONTRACT';
  operation: AdsStakeOperation;
  enabled: false;
  transaction: null;
}

export interface AdsReadyStakeTransactionPlan {
  status: 'READY';
  operation: AdsStakeOperation;
  enabled: true;
  transaction: AdsPreparedTransaction;
}

export type AdsStakeTransactionPlan =
  AdsDisabledStakeTransactionPlan | AdsReadyStakeTransactionPlan;

export interface AdsChainAdapter {
  snapshot(): AdsChainSnapshot;
  position(query: AdsChainPositionQuery): Promise<AdsChainPositionState | null>;
  createStake(input: AdsStakeOperationInput): Promise<AdsStakeTransactionPlan>;
  increaseStake(input: AdsStakeOperationInput): Promise<AdsStakeTransactionPlan>;
  unstake(input: AdsStakeOperationInput): Promise<AdsStakeTransactionPlan>;
}

/**
 * Production-safe phase-one adapter. It never treats database rows as authority before the
 * contract ABI, address and event mapping have been reviewed and wired into the worker.
 */
@Injectable()
export class AwaitingContractAdsChainAdapter implements AdsChainAdapter {
  snapshot(): AdsChainSnapshot {
    return {
      status: 'AWAITING_CONTRACT',
      chainId: config.deployment.chainId,
      contractAddress: config.adsContract.address,
      deploymentBlock: config.adsContract.deploymentBlock,
      transactionsEnabled: false,
    };
  }

  async position(_query: AdsChainPositionQuery) {
    return null;
  }

  async createStake(_input: AdsStakeOperationInput) {
    return this.disabledOperation('CREATE_STAKE');
  }

  async increaseStake(_input: AdsStakeOperationInput) {
    return this.disabledOperation('INCREASE_STAKE');
  }

  async unstake(_input: AdsStakeOperationInput) {
    return this.disabledOperation('UNSTAKE');
  }

  private disabledOperation(operation: AdsStakeOperation): AdsStakeTransactionPlan {
    return { status: 'AWAITING_CONTRACT', operation, enabled: false, transaction: null };
  }
}
