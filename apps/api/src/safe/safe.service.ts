import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PRECOMMUNITY_ESCROW_ABI, safeWalletQueueUrl } from '@precommunity/shared';
import SafeApiKit from '@safe-global/api-kit';
import Safe from '@safe-global/protocol-kit';
import { OperationType, type SafeTransactionData } from '@safe-global/types-kit';
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddressEqual,
  type Address,
} from 'viem';
import { deploymentTransactionRequest } from '../common/deployment-transaction';
import { config } from '../config';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SAFE_INFO_CACHE_MS = 15_000;

export interface SafeRuntimeInfo {
  address: Address;
  owners: Address[];
  threshold: number;
  nonce: number;
  escrowOwner: Address;
  isEscrowOwner: boolean;
  pendingOwner: Address;
  isPendingEscrowOwner: boolean;
  queueUrl: string;
}

export interface SafeOwnershipAcceptanceProposal {
  safeTxHash: string;
  safeNonce: number;
  confirmations: number;
  threshold: number;
  readyToExecute: boolean;
  queueUrl: string;
}

export interface SafeContractCall {
  to: string;
  value: string;
  data: string;
  operation: OperationType;
}

@Injectable()
export class SafeService {
  private readonly publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.BASE_RPC_URL),
  });
  private cachedInfo?: { value: SafeRuntimeInfo; expiresAt: number };
  private cachedService?: { value: boolean; expiresAt: number };

  configuredAddress(): Address | null {
    return config.SAFE_ADDRESS ? getAddress(config.SAFE_ADDRESS) : null;
  }

  isConfigured() {
    return Boolean(
      this.configuredAddress() &&
      (config.SAFE_TRANSACTION_SERVICE_API_KEY || config.SAFE_TRANSACTION_SERVICE_URL),
    );
  }

  private apiKit() {
    const apiKey = config.SAFE_TRANSACTION_SERVICE_API_KEY;
    if (!apiKey && !config.SAFE_TRANSACTION_SERVICE_URL) {
      throw new ServiceUnavailableException(
        'Safe Transaction Service API key is not configured for this environment',
      );
    }
    return new SafeApiKit({
      chainId: BigInt(config.deployment.chainId),
      ...(config.SAFE_TRANSACTION_SERVICE_URL
        ? { txServiceUrl: config.SAFE_TRANSACTION_SERVICE_URL }
        : {}),
      ...(apiKey ? { apiKey } : {}),
    });
  }

  private async protocolKit(signer?: string) {
    const safeAddress = this.configuredAddress();
    if (!safeAddress) {
      throw new ServiceUnavailableException('Safe address is not configured for this environment');
    }
    return Safe.init({
      provider: config.BASE_RPC_URL,
      safeAddress,
      ...(signer ? { signer } : {}),
    });
  }

  async runtimeInfo(force = false): Promise<SafeRuntimeInfo> {
    if (!force && this.cachedInfo && this.cachedInfo.expiresAt > Date.now()) {
      return this.cachedInfo.value;
    }
    const safeAddress = this.configuredAddress();
    if (!safeAddress) {
      throw new ServiceUnavailableException('Safe address is not configured for this environment');
    }
    try {
      const code = await this.publicClient.getCode({ address: safeAddress });
      if (!code || code === '0x') {
        throw new Error('Configured Safe is not deployed on the active network');
      }
      const protocolKit = await this.protocolKit();
      const [owners, threshold, nonce, escrowOwner, pendingOwner] = await Promise.all([
        protocolKit.getOwners(),
        protocolKit.getThreshold(),
        protocolKit.getNonce(),
        this.publicClient.readContract({
          address: getAddress(config.deployment.escrowAddress),
          abi: PRECOMMUNITY_ESCROW_ABI,
          functionName: 'owner',
        }),
        this.publicClient.readContract({
          address: getAddress(config.deployment.escrowAddress),
          abi: PRECOMMUNITY_ESCROW_ABI,
          functionName: 'pendingOwner',
        }),
      ]);
      const value: SafeRuntimeInfo = {
        address: safeAddress,
        owners: owners.map((owner) => getAddress(owner)),
        threshold,
        nonce,
        escrowOwner: getAddress(escrowOwner),
        isEscrowOwner: isAddressEqual(safeAddress, getAddress(escrowOwner)),
        pendingOwner: getAddress(pendingOwner),
        isPendingEscrowOwner: isAddressEqual(safeAddress, getAddress(pendingOwner)),
        queueUrl: safeWalletQueueUrl(safeAddress, config.deployment),
      };
      this.cachedInfo = { value, expiresAt: Date.now() + SAFE_INFO_CACHE_MS };
      return value;
    } catch (error) {
      const message =
        error instanceof Error &&
        error.message === 'Configured Safe is not deployed on the active network'
          ? error.message
          : `Safe configuration could not be verified on ${config.deployment.networkName}`;
      throw new ServiceUnavailableException(message);
    }
  }

  async transactionServiceReady(force = false) {
    if (!this.isConfigured()) return false;
    if (!force && this.cachedService && this.cachedService.expiresAt > Date.now()) {
      return this.cachedService.value;
    }
    const safeAddress = this.configuredAddress();
    if (!safeAddress) return false;
    try {
      const info = await this.apiKit().getSafeInfo(safeAddress);
      const value = isAddressEqual(getAddress(info.address), safeAddress);
      this.cachedService = { value, expiresAt: Date.now() + SAFE_INFO_CACHE_MS };
      return value;
    } catch {
      this.cachedService = { value: false, expiresAt: Date.now() + SAFE_INFO_CACHE_MS };
      return false;
    }
  }

  async isOwner(address: string) {
    if (!this.configuredAddress()) return false;
    try {
      const info = await this.runtimeInfo();
      return info.owners.some((owner) => isAddressEqual(owner, getAddress(address)));
    } catch {
      return false;
    }
  }

  async assertOwner(address: string, force = false) {
    const info = await this.runtimeInfo(force);
    if (!info.owners.some((owner) => isAddressEqual(owner, getAddress(address)))) {
      throw new ForbiddenException('The connected wallet is not an owner of the configured Safe');
    }
    return info;
  }

  async assertPayoutReady(address: string) {
    const info = await this.assertOwner(address, true);
    if (!info.isEscrowOwner) {
      throw new ServiceUnavailableException(
        'Safe must become the confirmed escrow owner before payout proposals can be created',
      );
    }
    if (!(await this.transactionServiceReady(true))) {
      throw new ServiceUnavailableException(
        'Safe Transaction Service is unavailable or not configured',
      );
    }
    return info;
  }

  async goalManagerMetrics(addresses: string[]) {
    const escrowAddress = getAddress(config.deployment.escrowAddress);
    const normalized = [...new Set(addresses.map((address) => getAddress(address)))];
    const [maxOpenGoals, entries] = await Promise.all([
      this.publicClient.readContract({
        address: escrowAddress,
        abi: PRECOMMUNITY_ESCROW_ABI,
        functionName: 'maxOpenGoalsPerManager',
      }),
      Promise.all(
        normalized.map(async (address) => {
          const [enabled, openGoalCount] = await Promise.all([
            this.publicClient.readContract({
              address: escrowAddress,
              abi: PRECOMMUNITY_ESCROW_ABI,
              functionName: 'goalManagers',
              args: [address],
            }),
            this.publicClient.readContract({
              address: escrowAddress,
              abi: PRECOMMUNITY_ESCROW_ABI,
              functionName: 'openGoalCountByCreator',
              args: [address],
            }),
          ]);
          return { address, enabled, openGoalCount: Number(openGoalCount) };
        }),
      ),
    ]);
    return { maxOpenGoals: Number(maxOpenGoals), entries };
  }

  async createTransactionData(transactions: SafeContractCall[], nonce: number) {
    const protocolKit = await this.protocolKit();
    const safeTransaction = await protocolKit.createTransaction({
      transactions,
      options: { nonce },
    });
    return safeTransaction.data;
  }

  async ownershipTransferRequest(currentOwner: string) {
    const info = await this.runtimeInfo(true);
    if (info.isEscrowOwner) {
      throw new ForbiddenException('Safe is already the escrow owner');
    }
    try {
      await this.publicClient.simulateContract({
        account: getAddress(currentOwner),
        address: getAddress(config.deployment.escrowAddress),
        abi: PRECOMMUNITY_ESCROW_ABI,
        functionName: 'transferOwnership',
        args: [info.address],
      });
      return deploymentTransactionRequest({
        to: getAddress(config.deployment.escrowAddress),
        value: '0',
        data: encodeFunctionData({
          abi: PRECOMMUNITY_ESCROW_ABI,
          functionName: 'transferOwnership',
          args: [info.address],
        }),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Ownership transfer preflight failed. Verify the current owner and Safe network.',
      );
    }
  }

  private ownershipAcceptanceData() {
    return encodeFunctionData({
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'acceptOwnership',
    });
  }

  async ownershipAcceptanceStatus(
    currentInfo?: SafeRuntimeInfo,
  ): Promise<SafeOwnershipAcceptanceProposal | null> {
    const info = currentInfo ?? (await this.runtimeInfo(true));
    if (info.isEscrowOwner || !info.isPendingEscrowOwner || !this.isConfigured()) return null;

    const expectedData = this.ownershipAcceptanceData().toLowerCase();
    try {
      const pending = await this.apiKit().getPendingTransactions(info.address, {
        currentNonce: info.nonce,
        limit: 100,
        ordering: 'nonce',
      });
      const transaction = [...pending.results]
        .sort((left, right) => Number(left.nonce) - Number(right.nonce))
        .find(
          (candidate) =>
            !candidate.isExecuted &&
            isAddressEqual(getAddress(candidate.to), getAddress(config.deployment.escrowAddress)) &&
            candidate.value === '0' &&
            (candidate.data ?? '0x').toLowerCase() === expectedData &&
            candidate.operation === OperationType.Call,
        );
      if (!transaction) return null;

      const confirmations = transaction.confirmations?.length ?? 0;
      const threshold = transaction.confirmationsRequired || info.threshold;
      return {
        safeTxHash: transaction.safeTxHash,
        safeNonce: Number(transaction.nonce),
        confirmations,
        threshold,
        readyToExecute: confirmations >= threshold,
        queueUrl: info.queueUrl,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Safe Transaction Service could not check the ownership acceptance queue',
      );
    }
  }

  async ownershipAcceptanceRequest(signer: string) {
    const info = await this.runtimeInfo(true);
    if (!info.owners.some((owner) => isAddressEqual(owner, getAddress(signer)))) {
      throw new ForbiddenException('The connected wallet is not an owner of the configured Safe');
    }
    if (info.isEscrowOwner) throw new ForbiddenException('Safe is already the escrow owner');
    if (!info.isPendingEscrowOwner) {
      throw new ForbiddenException('Safe is not the pending escrow owner');
    }
    if (!(await this.transactionServiceReady(true))) {
      throw new ServiceUnavailableException(
        'Safe Transaction Service must be available before ownership can be accepted',
      );
    }

    const transactionRequest = deploymentTransactionRequest({
      to: getAddress(config.deployment.escrowAddress),
      value: '0',
      data: this.ownershipAcceptanceData(),
    });
    try {
      await this.publicClient.simulateContract({
        account: info.address,
        address: transactionRequest.to,
        abi: PRECOMMUNITY_ESCROW_ABI,
        functionName: 'acceptOwnership',
      });
    } catch {
      throw new ServiceUnavailableException(
        'Ownership acceptance preflight failed. Verify the pending owner on-chain.',
      );
    }

    const existingProposal = await this.ownershipAcceptanceStatus(info);
    return {
      safeAddress: info.address,
      safeNonce: existingProposal?.safeNonce ?? (await this.nextNonce()),
      threshold: info.threshold,
      queueUrl: info.queueUrl,
      transactionRequest,
      existingProposal,
    };
  }

  async nextNonce() {
    const info = await this.runtimeInfo();
    try {
      const nonce = await this.apiKit().getNextNonce(info.address);
      return Number(nonce);
    } catch {
      throw new ServiceUnavailableException('Could not determine the next Safe nonce');
    }
  }

  validateTransactionData(
    transaction: SafeTransactionData,
    expected: { to: string; value: string; data: string; nonce: number },
    purpose = 'proposal',
  ) {
    const normalizedRefundReceiver = transaction.refundReceiver || ZERO_ADDRESS;
    const valid =
      isAddressEqual(getAddress(transaction.to), getAddress(expected.to)) &&
      transaction.value === expected.value &&
      transaction.data.toLowerCase() === expected.data.toLowerCase() &&
      transaction.operation === OperationType.Call &&
      transaction.nonce === expected.nonce &&
      transaction.safeTxGas === '0' &&
      transaction.baseGas === '0' &&
      transaction.gasPrice === '0' &&
      isAddressEqual(getAddress(transaction.gasToken), getAddress(ZERO_ADDRESS)) &&
      isAddressEqual(getAddress(normalizedRefundReceiver), getAddress(ZERO_ADDRESS));
    if (!valid) {
      throw new ForbiddenException(`Signed Safe transaction does not match the ${purpose}`);
    }
  }

  validateExactTransactionData(
    transaction: SafeTransactionData,
    expected: SafeTransactionData,
    purpose = 'proposal',
  ) {
    const normalizedRefundReceiver = transaction.refundReceiver || ZERO_ADDRESS;
    const expectedRefundReceiver = expected.refundReceiver || ZERO_ADDRESS;
    const valid =
      isAddressEqual(getAddress(transaction.to), getAddress(expected.to)) &&
      transaction.value === expected.value &&
      transaction.data.toLowerCase() === expected.data.toLowerCase() &&
      transaction.operation === expected.operation &&
      transaction.nonce === expected.nonce &&
      transaction.safeTxGas === expected.safeTxGas &&
      transaction.baseGas === expected.baseGas &&
      transaction.gasPrice === expected.gasPrice &&
      isAddressEqual(getAddress(transaction.gasToken), getAddress(expected.gasToken)) &&
      isAddressEqual(getAddress(normalizedRefundReceiver), getAddress(expectedRefundReceiver));
    if (!valid) {
      throw new ForbiddenException(`Signed Safe transaction does not match the ${purpose}`);
    }
  }

  async transactionHash(transaction: SafeTransactionData) {
    try {
      const protocolKit = await this.protocolKit();
      const safeTransaction = await protocolKit.createTransaction({
        transactions: [
          {
            to: transaction.to,
            value: transaction.value,
            data: transaction.data,
            operation: transaction.operation,
          },
        ],
        options: {
          nonce: transaction.nonce,
          safeTxGas: transaction.safeTxGas,
          baseGas: transaction.baseGas,
          gasPrice: transaction.gasPrice,
          gasToken: transaction.gasToken,
          refundReceiver: transaction.refundReceiver,
        },
      });
      return protocolKit.getTransactionHash(safeTransaction);
    } catch {
      throw new ServiceUnavailableException('Could not verify the signed Safe transaction');
    }
  }

  async propose(input: {
    transaction: SafeTransactionData;
    safeTxHash: string;
    senderAddress: string;
    senderSignature: string;
  }) {
    const safeAddress = this.configuredAddress();
    if (!safeAddress) throw new ServiceUnavailableException('Safe is not configured');
    try {
      await this.apiKit().proposeTransaction({
        safeAddress,
        safeTransactionData: input.transaction,
        safeTxHash: input.safeTxHash,
        senderAddress: getAddress(input.senderAddress),
        senderSignature: input.senderSignature,
        origin: 'precommunity',
      });
    } catch {
      try {
        const existing = await this.apiKit().getTransaction(input.safeTxHash);
        if (existing.safeTxHash.toLowerCase() === input.safeTxHash.toLowerCase()) return;
      } catch {
        // A secondary lookup failure does not change the proposal result.
      }
      throw new ServiceUnavailableException('Safe rejected the transaction proposal');
    }
  }
}
