import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { PRE_KEYWORD_MARKET_ABI } from '@precommunity/shared';
import {
  BaseError,
  InsufficientFundsError,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbiParameters,
} from 'viem';
import { createChargeChain, unlockChargeOperator } from './keyword-market-charges-chain';

const mock = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  decrypt: vi.fn(),
  totalFee: vi.fn(),
  rpc: {
    getChainId: vi.fn(),
    getBlockNumber: vi.fn(),
    getBlock: vi.fn(),
    readContract: vi.fn(),
    getBalance: vi.fn(),
    getTransactionCount: vi.fn(),
    getTransactionReceipt: vi.fn(),
    simulateContract: vi.fn(),
    prepareTransactionRequest: vi.fn(),
    sendRawTransaction: vi.fn(),
  },
}));
vi.mock('ethers', () => ({ Wallet: { fromEncryptedJson: mock.decrypt } }));
vi.mock('viem/op-stack', () => ({ estimateTotalFee: mock.totalFee }));
vi.mock('node:fs/promises', () => ({ readFile: mock.readFile, stat: mock.stat }));
vi.mock('./config', () => ({
  config: {
    chain: { id: 84532 },
    BASE_RPC_URL: 'https://unused.test',
    adsContract: { address: `0x${'ab'.repeat(20)}`, deploymentBlock: '1' },
    deployment: {
      chainId: 84532,
      preAddress: `0x${'12'.repeat(20)}`,
      owner: `0x${'34'.repeat(20)}`,
      confirmations: 12,
    },
  },
}));
vi.mock('viem', async (original) => ({
  ...(await original<typeof import('viem')>()),
  createPublicClient: () => mock.rpc,
}));
vi.mock('./keyword-market-readiness', () => ({ verifyKeywordMarketReadiness: vi.fn() }));

const address = `0x${'ab'.repeat(20)}`;
const chargeId = `0x${'cd'.repeat(32)}` as const;
const keywordId = `0x${'ef'.repeat(32)}` as const;
const staker = `0x${'11'.repeat(20)}` as const;

beforeEach(() => {
  vi.resetAllMocks();
  mock.stat.mockResolvedValue({ size: 100 });
  mock.readFile.mockResolvedValue('encrypted-keystore');
  mock.decrypt.mockResolvedValue({ privateKey: `0x${'11'.repeat(32)}` });
  mock.totalFee.mockResolvedValue(0n);
});

describe('operator keystore', () => {
  it('resolves relative keystore paths from the repository root', async () => {
    await unlockChargeOperator('.keystore-operator.json', 'fixture');
    expect(mock.readFile).toHaveBeenCalledWith(
      resolve(__dirname, '../../../.keystore-operator.json'),
      'utf8',
    );
  });
  it('uses encrypted JSON and preserves the exact password including spaces', async () => {
    const account = await unlockChargeOperator(
      '/keystore/operator.json',
      '  password with spaces  ',
    );
    expect(mock.readFile).toHaveBeenCalledWith('/keystore/operator.json', 'utf8');
    expect(mock.decrypt).toHaveBeenCalledWith('encrypted-keystore', '  password with spaces  ');
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(account.type).toBe('local');
  });
  it('supports an intentionally empty keystore password', async () => {
    await unlockChargeOperator('/keystore/operator.json', '');
    expect(mock.decrypt).toHaveBeenCalledWith('encrypted-keystore', '');
  });
  it('reports missing configuration or oversized/unreadable files without secret details', async () => {
    await expect(unlockChargeOperator(null, 'secret')).rejects.toMatchObject({
      code: 'KEYSTORE_MISSING',
      message: 'KEYSTORE_MISSING',
    });
    mock.stat.mockResolvedValue({ size: 2_000_000 });
    await expect(unlockChargeOperator('/private/secret-name', 'secret')).rejects.toMatchObject({
      code: 'KEYSTORE_MISSING',
    });
    expect(mock.readFile).not.toHaveBeenCalled();
    mock.stat.mockRejectedValue(new Error('path contains private-secret'));
    await expect(unlockChargeOperator('/private/secret-name', 'secret')).rejects.toMatchObject({
      message: 'KEYSTORE_MISSING',
    });
  });
  it('sanitizes missing or incorrect passwords without returning encrypted contents', async () => {
    await expect(unlockChargeOperator('/keystore', undefined)).rejects.toMatchObject({
      code: 'KEYSTORE_INVALID',
    });
    mock.decrypt.mockRejectedValue(new Error('encrypted-keystore secret password'));
    await expect(unlockChargeOperator('/keystore', 'secret')).rejects.toMatchObject({
      message: 'KEYSTORE_INVALID',
    });
  });
});

describe('charge chain adapter', () => {
  it('rejects a wrong RPC network before processing or broadcasting transactions', async () => {
    mock.rpc.getChainId.mockResolvedValue(1);
    await expect(createChargeChain().head()).rejects.toMatchObject({ code: 'CHAIN_MISMATCH' });
    expect(mock.rpc.getBlockNumber).not.toHaveBeenCalled();
    expect(mock.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it('accepts the actual StakeCharged event only from the configured market and matching charge ID', async () => {
    const topics = encodeEventTopics({
      abi: PRE_KEYWORD_MARKET_ABI,
      eventName: 'StakeCharged',
      args: { keywordId, staker, chargeId },
    });
    const data = encodeAbiParameters(parseAbiParameters('uint256,uint256,uint256'), [20n, 7n, 1n]);
    mock.rpc.getTransactionReceipt.mockResolvedValue({
      blockNumber: 10n,
      blockHash: '0xblock',
      status: 'success',
      logs: [
        { address: staker, topics, data },
        { address, topics, data },
      ],
    });
    const result = await createChargeChain().receipt('0xhash', chargeId);
    expect(result).toMatchObject({
      blockNumber: 10n,
      reverted: false,
      event: { chargeId, keywordId, requestedPre: 20n, chargedPre: 7n },
    });
    expect((await createChargeChain().receipt('0xhash', `0x${'01'.repeat(32)}`))!.event).toBeNull();
  });
  it('simulates the exact immutable charge and signs locally without broadcasting', async () => {
    const signer = { address: staker, signTransaction: vi.fn().mockResolvedValue('0x1234') };
    mock.rpc.prepareTransactionRequest.mockResolvedValue({
      data: '0xdata',
      nonce: 5,
      gas: 100n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
    });
    mock.rpc.getBalance.mockResolvedValue(1_000n);
    const batch = {
      keywordId,
      stakerAddress: staker,
      positionVersion: 2n,
      requestedPreRaw: '20',
      chargeId,
    };
    const result = await createChargeChain().sign(batch as never, signer as never, 5n);
    expect(mock.rpc.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'chargeStake',
        args: [keywordId, staker, 2n, 20n, chargeId],
      }),
    );
    expect(signer.signTransaction).toHaveBeenCalledWith({
      type: 'eip1559',
      chainId: 84532,
      to: address,
      data: '0xdata',
      nonce: 5,
      gas: 100n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
    });
    expect(result).toEqual({ raw: '0x1234', hash: keccak256('0x1234') });
    expect(mock.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it('checks the estimated gas cost and sanitizes RPC/simulation failures', async () => {
    const signer = { address: staker, signTransaction: vi.fn() };
    const batch = {
      keywordId,
      stakerAddress: staker,
      positionVersion: 2n,
      requestedPreRaw: '20',
      chargeId,
    };
    mock.rpc.prepareTransactionRequest.mockResolvedValue({ gas: 100n, maxFeePerGas: 2n });
    mock.rpc.getBalance.mockResolvedValue(199n);
    await expect(
      createChargeChain().sign(batch as never, signer as never, 5n),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_GAS' });
    expect(signer.signTransaction).not.toHaveBeenCalled();
    mock.rpc.simulateContract.mockRejectedValue(new Error('rpc-secret transaction-bytes'));
    await expect(
      createChargeChain().sign(batch as never, signer as never, 5n),
    ).rejects.toMatchObject({ message: 'TRANSACTION_FAILED' });
  });
  it('blocks signing when Base L1 and operator fees exceed the L2 gas cap', async () => {
    const signer = { address: staker, signTransaction: vi.fn() };
    const batch = {
      keywordId,
      stakerAddress: staker,
      positionVersion: 2n,
      requestedPreRaw: '20',
      chargeId,
    };
    mock.rpc.prepareTransactionRequest.mockResolvedValue({
      data: '0xdata',
      nonce: 5,
      gas: 100n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
    });
    mock.rpc.getBalance.mockResolvedValue(300n);
    mock.totalFee.mockResolvedValue(500n);
    await expect(
      createChargeChain().sign(batch as never, signer as never, 5n),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_GAS' });
    expect(mock.totalFee).toHaveBeenCalledWith(
      mock.rpc,
      expect.objectContaining({ account: signer, gas: 100n, maxFeePerGas: 2n }),
    );
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });
  it('reports insufficient funds hidden in provider error causes without exposing their messages', async () => {
    const failure = new BaseError('private-rpc-secret', { cause: new InsufficientFundsError() });
    const signer = { address: staker, signTransaction: vi.fn() };
    const batch = {
      keywordId,
      stakerAddress: staker,
      positionVersion: 2n,
      requestedPreRaw: '20',
      chargeId,
    };
    mock.rpc.simulateContract.mockRejectedValue(failure);
    await expect(
      createChargeChain().sign(batch as never, signer as never, 5n),
    ).rejects.toMatchObject({ message: 'INSUFFICIENT_GAS' });
    mock.rpc.sendRawTransaction.mockRejectedValue(failure);
    await expect(createChargeChain().broadcast('0x1234')).rejects.toMatchObject({
      message: 'INSUFFICIENT_GAS',
    });
  });
});
