import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createPublicClient, getAddress, http, parseUnits } from 'viem';
import { config } from '../config';

const erc20BalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const CURRENT_CACHE_MS = 30_000;

@Injectable()
export class TokenEligibilityService {
  private readonly client = createPublicClient({
    chain: config.chain,
    transport: http(config.BASE_RPC_URL),
  });
  private readonly minimumRaw = parseUnits(config.COMMUNITY_MIN_PRE, 18);
  private readonly currentCache = new Map<string, { balance: bigint; expiresAt: number }>();
  private readonly snapshotCache = new Map<string, bigint>();

  minimum() {
    return {
      amount: config.COMMUNITY_MIN_PRE,
      amountRaw: this.minimumRaw.toString(),
      asset: 'PRE' as const,
    };
  }

  private async read(address: string, blockNumber?: bigint) {
    try {
      return await this.client.readContract({
        address: getAddress(config.deployment.preAddress),
        abi: erc20BalanceAbi,
        functionName: 'balanceOf',
        args: [getAddress(address)],
        blockNumber,
      });
    } catch {
      throw new ServiceUnavailableException(
        'PRE membership could not be verified because the Base RPC is unavailable',
      );
    }
  }

  async currentBalance(address: string) {
    const key = address.toLowerCase();
    const cached = this.currentCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.balance;
    const balance = await this.read(key);
    this.currentCache.set(key, { balance, expiresAt: Date.now() + CURRENT_CACHE_MS });
    return balance;
  }

  async status(address: string) {
    const balance = await this.currentBalance(address);
    return {
      eligible: balance >= this.minimumRaw,
      balanceRaw: balance.toString(),
      required: this.minimum(),
    };
  }

  async assertCurrent(address: string) {
    const result = await this.status(address);
    if (!result.eligible)
      throw new ForbiddenException(
        `At least ${config.COMMUNITY_MIN_PRE} PRE is required to participate`,
      );
    return BigInt(result.balanceRaw);
  }

  async confirmedSnapshotBlock() {
    try {
      const latest = await this.client.getBlockNumber();
      const confirmations = BigInt(config.deployment.confirmations);
      return latest > confirmations ? latest - confirmations : 0n;
    } catch {
      throw new ServiceUnavailableException(
        'A confirmed Base snapshot block could not be selected',
      );
    }
  }

  async snapshotBalance(address: string, blockNumber: bigint) {
    const key = `${blockNumber}:${address.toLowerCase()}`;
    const cached = this.snapshotCache.get(key);
    if (cached !== undefined) return cached;
    const balance = await this.read(address, blockNumber);
    this.snapshotCache.set(key, balance);
    return balance;
  }

  assertSnapshotEligible(balance: bigint) {
    if (balance < this.minimumRaw)
      throw new ForbiddenException(
        `This wallet held less than ${config.COMMUNITY_MIN_PRE} PRE at the voting snapshot`,
      );
  }
}
