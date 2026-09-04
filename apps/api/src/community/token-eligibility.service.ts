import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { erc20Abi, createPublicClient, formatUnits, getAddress, http, parseUnits } from 'viem';
import { config } from '../config';

const CURRENT_CACHE_MS = 30_000;

@Injectable()
export class TokenEligibilityService {
  private readonly client = createPublicClient({
    chain: config.chain,
    transport: http(config.BASE_RPC_URL),
  });
  private readonly defaultMinimumRaw = parseUnits(config.COMMUNITY_MIN_PRE, 18);
  private readonly currentCache = new Map<string, { balance: bigint; expiresAt: number }>();
  private readonly snapshotCache = new Map<string, bigint>();

  minimum(minimumRaw = this.defaultMinimumRaw) {
    return {
      amount: formatUnits(minimumRaw, 18),
      amountRaw: minimumRaw.toString(),
      asset: 'PRE' as const,
    };
  }

  private async read(address: string, blockNumber?: bigint) {
    try {
      return await this.client.readContract({
        address: getAddress(config.deployment.preAddress),
        abi: erc20Abi,
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

  async status(address: string, minimumRaw = this.defaultMinimumRaw) {
    if (minimumRaw === 0n) {
      return { eligible: true, balanceRaw: '0', required: this.minimum(minimumRaw) };
    }
    const balance = await this.currentBalance(address);
    return {
      eligible: balance >= minimumRaw,
      balanceRaw: balance.toString(),
      required: this.minimum(minimumRaw),
    };
  }

  async assertCurrent(
    address: string,
    minimumRaw = this.defaultMinimumRaw,
    purpose = 'participate',
  ) {
    const result = await this.status(address, minimumRaw);
    if (!result.eligible)
      throw new ForbiddenException(
        `At least ${result.required.amount} PRE is required to ${purpose}`,
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
    if (balance < this.defaultMinimumRaw)
      throw new ForbiddenException(
        `This wallet held less than ${config.COMMUNITY_MIN_PRE} PRE at the voting snapshot`,
      );
  }
}
