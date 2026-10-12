import { PRE_KEYWORD_MARKET_ABI } from '@precommunity/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BaseError,
  encodeAbiParameters,
  encodeEventTopics,
  InsufficientFundsError,
  keccak256,
  parseAbiParameters,
  TransactionReceiptNotFoundError,
} from 'viem';
import { createPricePublicationChain, unlockPriceUpdater } from './pre-usd-price-publication-chain';

const mock = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  decrypt: vi.fn(),
  totalFee: vi.fn(),
  rpc: {
    getChainId: vi.fn(),
    getBlockNumber: vi.fn(),
    getBlock: vi.fn(),
    getBytecode: vi.fn(),
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
      confirmations: 2,
    },
  },
}));
vi.mock('viem', async (original) => ({
  ...(await original<typeof import('viem')>()),
  createPublicClient: () => mock.rpc,
}));
vi.mock('./keyword-market-readiness', () => ({
  loadReviewedMarketArtifact: () => ({
    artifact: {
      contractName: 'PREKeywordMarketV1',
      buildInfoId: 'reviewed',
      abi: PRE_KEYWORD_MARKET_ABI,
      deployedBytecode: '0x6000',
    },
  }),
  normalizedMarketRuntime: (value: string) => value,
}));

const address = `0x${'ab'.repeat(20)}`;
const pre = `0x${'12'.repeat(20)}`;
const safe = `0x${'34'.repeat(20)}`;
const hash = `0x${'cd'.repeat(32)}` as const;

beforeEach(() => {
  vi.resetAllMocks();
  mock.stat.mockResolvedValue({ size: 100 });
  mock.readFile.mockResolvedValue('encrypted-key');
  mock.decrypt.mockResolvedValue({ privateKey: `0x${'11'.repeat(32)}` });
  mock.totalFee.mockResolvedValue(0n);
  mock.rpc.getChainId.mockResolvedValue(84532);
  mock.rpc.getBlockNumber.mockResolvedValue(100n);
  mock.rpc.getBytecode.mockImplementation(async ({ blockNumber }) =>
    blockNumber === 0n ? undefined : '0x6000',
  );
  mock.rpc.readContract.mockImplementation(
    async ({ functionName }) =>
      ({
        PRE: pre,
        owner: safe,
        decimals: 18,
        preUsdPriceE18: 557000000000000n,
        preUsdPriceQuotedAt: 1791800000n,
        priceUpdater: pre,
        operator: safe,
      })[functionName as 'PRE'],
  );
});

describe('dedicated updater keystore', () => {
  it('reuses encrypted keystore handling, preserving a deliberately empty password', async () => {
    const account = await unlockPriceUpdater('/updater.json', '');
    expect(account.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(mock.decrypt).toHaveBeenCalledWith('encrypted-key', '');
  });
  it('sanitizes missing or invalid updater credentials', async () => {
    await expect(unlockPriceUpdater(null, 'password')).rejects.toMatchObject({
      message: 'KEYSTORE_MISSING',
    });
    mock.decrypt.mockRejectedValue(new Error('private password encrypted-key'));
    await expect(unlockPriceUpdater('/updater.json', 'password')).rejects.toMatchObject({
      message: 'KEYSTORE_INVALID',
    });
  });
});

describe('price publication chain adapter', () => {
  it('rejects an RPC pointing at another chain before other work', async () => {
    mock.rpc.getChainId.mockResolvedValue(1);
    await expect(createPricePublicationChain().head()).rejects.toMatchObject({
      code: 'CHAIN_MISMATCH',
    });
    expect(mock.rpc.getBlockNumber).not.toHaveBeenCalled();
  });
  it('verifies reviewed runtime, token and Safe without an indexer or initial price', async () => {
    await expect(createPricePublicationChain().verify()).resolves.toBeUndefined();
    expect(mock.rpc.readContract.mock.calls.map(([request]) => request.functionName)).toEqual([
      'PRE',
      'owner',
      'decimals',
    ]);
    expect(mock.rpc.getBytecode).toHaveBeenCalledWith({ address, blockNumber: 0n });
  });
  it('rejects a changed runtime even when contract identity getters match', async () => {
    mock.rpc.getBytecode.mockImplementation(async ({ address: target, blockNumber }) =>
      blockNumber === 0n ? undefined : target === address ? '0x6001' : '0x6000',
    );
    await expect(createPricePublicationChain().verify()).rejects.toMatchObject({
      code: 'CONTRACT_MISMATCH',
    });
  });
  it('reads price and timestamp from one pinned block even when latest advances', async () => {
    expect(await createPricePublicationChain().price()).toEqual({
      priceE18: 557000000000000n,
      quotedAt: 1791800000n,
    });
    expect(mock.rpc.readContract.mock.calls.map(([request]) => request.blockNumber)).toEqual([
      100n,
      100n,
    ]);
    mock.rpc.getBlockNumber.mockClear();
    await createPricePublicationChain().price(90n);
    expect(mock.rpc.getBlockNumber).not.toHaveBeenCalled();
    expect(
      mock.rpc.readContract.mock.calls.slice(-2).map(([request]) => request.blockNumber),
    ).toEqual([90n, 90n]);
  });
  it('only acknowledges the price update event from the configured market', async () => {
    const topics = encodeEventTopics({
      abi: PRE_KEYWORD_MARKET_ABI,
      eventName: 'PreUsdPriceUpdated',
    });
    const data = encodeAbiParameters(parseAbiParameters('uint256,uint64'), [
      557000000000000n,
      1791800000n,
    ]);
    mock.rpc.getTransactionReceipt.mockResolvedValue({
      blockNumber: 90n,
      blockHash: hash,
      status: 'success',
      logs: [{ address: pre, topics, data }],
    });
    expect((await createPricePublicationChain().receipt(hash))?.event).toBeNull();
    mock.rpc.getTransactionReceipt.mockResolvedValue({
      blockNumber: 90n,
      blockHash: hash,
      status: 'success',
      logs: [{ address, topics, data }],
    });
    expect(await createPricePublicationChain().receipt(hash)).toEqual({
      blockNumber: 90n,
      blockHash: hash,
      reverted: false,
      event: { priceE18: 557000000000000n, quotedAt: 1791800000n },
    });
  });
  it('distinguishes a missing receipt from a failed RPC without leaking provider details', async () => {
    mock.rpc.getTransactionReceipt.mockRejectedValue(new TransactionReceiptNotFoundError({ hash }));
    expect(await createPricePublicationChain().receipt(hash)).toBeNull();
    mock.rpc.getTransactionReceipt.mockRejectedValue(new Error('private RPC password'));
    await expect(createPricePublicationChain().receipt(hash)).rejects.toMatchObject({
      message: 'RPC_UNAVAILABLE',
    });
  });
  it('signs only after simulation and checks the full Base transaction fee', async () => {
    const signTransaction = vi.fn().mockResolvedValue('0x0102');
    const account = { address: pre, signTransaction };
    mock.rpc.prepareTransactionRequest.mockResolvedValue({
      gas: 100n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      nonce: 3,
      data: '0x1234',
    });
    mock.totalFee.mockResolvedValue(1000n);
    mock.rpc.getBalance.mockResolvedValue(999n);
    const publication = { priceE18Raw: '557000000000000', quotedAt: 1791800000n };
    await expect(
      createPricePublicationChain().sign(publication as never, account as never, 3n),
    ).rejects.toMatchObject({ message: 'INSUFFICIENT_GAS' });
    expect(signTransaction).not.toHaveBeenCalled();
    mock.rpc.getBalance.mockResolvedValue(1000n);
    expect(
      await createPricePublicationChain().sign(publication as never, account as never, 3n),
    ).toEqual({ raw: '0x0102', hash: keccak256('0x0102') });
    expect(mock.rpc.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'updatePreUsdPrice',
        args: [557000000000000n, 1791800000n],
      }),
    );
  });
  it('sanitizes insufficient funds and ambiguous send errors', async () => {
    mock.rpc.sendRawTransaction.mockRejectedValue(
      new BaseError('secret', { cause: new InsufficientFundsError() }),
    );
    await expect(createPricePublicationChain().broadcast('0x1234')).rejects.toMatchObject({
      message: 'INSUFFICIENT_GAS',
    });
    mock.rpc.sendRawTransaction.mockRejectedValue(new Error('secret signed bytes'));
    await expect(createPricePublicationChain().broadcast('0x1234')).rejects.toMatchObject({
      message: 'TRANSACTION_UNKNOWN',
    });
  });
});
