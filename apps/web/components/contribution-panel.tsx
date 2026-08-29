'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleX, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import {
  PRECOMMUNITY_ESCROW_ABI,
  isDeploymentConfigured,
  type GoalSummary,
  type SponsorVisibility,
} from '@precommunity/shared';
import { formatEther, getAddress, parseUnits } from 'viem';
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { activeChain, activeDeployment } from '@/lib/deployment';
import { requireSuccessfulReceipt } from '@/lib/transactions';
import { ActionButton } from './action-button';

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const APPROVAL_CONFIRMATIONS = 3;
const zeroAddress = '0x0000000000000000000000000000000000000000' as const;

function defaultPublicFrom(value: unknown) {
  if (Array.isArray(value)) return Boolean(value[6]);
  if (value && typeof value === 'object')
    return Boolean((value as Record<string, unknown>).defaultPublic);
  return false;
}

export function ContributionPanel({ goal }: { goal: GoalSummary }) {
  const available = goal.progress.map((item) => item.asset);
  const [asset, setAsset] = useState<'PRE' | 'USDC'>(available[0] ?? 'PRE');
  const [amount, setAmount] = useState('');
  const [visibility, setVisibility] = useState<SponsorVisibility>('ANONYMOUS');
  const [gas, setGas] = useState('Estimated in wallet');
  const [state, setState] = useState<
    | 'idle'
    | 'checking-balance'
    | 'approving'
    | 'confirming-approval'
    | 'contributing'
    | 'confirming-contribution'
    | 'confirmed'
    | 'error'
  >('idle');
  const [error, setError] = useState('');
  const { address, chainId, isConnected, status: accountStatus } = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const visibilityChosenRef = useRef(false);
  const walletIsRestoring = accountStatus === 'connecting' || accountStatus === 'reconnecting';
  const configured = isDeploymentConfigured(activeDeployment);
  const canContribute =
    goal.status === 'OPEN' &&
    configured &&
    (goal.monthly
      ? goal.monthly.phase === 'ACTIVE' || goal.monthly.phase === 'STOPPING'
      : new Date(goal.deadline).getTime() > Date.now());
  const escrowAddress = getAddress(activeDeployment.escrowAddress);
  const tokenAddress = getAddress(
    asset === 'PRE' ? activeDeployment.preAddress : activeDeployment.usdcAddress,
  );
  const profileRead = useReadContract({
    address: escrowAddress,
    abi: PRECOMMUNITY_ESCROW_ABI,
    functionName: 'getProfile',
    args: [address ?? zeroAddress],
    chainId: activeChain.id,
    query: { enabled: configured && Boolean(address) },
  });
  const rawAmount = useMemo(() => {
    try {
      return parseUnits(amount || '0', asset === 'PRE' ? 18 : 6);
    } catch {
      return 0n;
    }
  }, [amount, asset]);

  useEffect(() => {
    let active = true;
    publicClient
      ?.getGasPrice()
      .then((price) => {
        if (active) setGas(`≈ ${formatEther(price * 150_000n)} ETH`);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [publicClient]);

  useEffect(() => {
    visibilityChosenRef.current = false;
    setVisibility('ANONYMOUS');
  }, [address]);

  useEffect(() => {
    if (!address || profileRead.data === undefined || visibilityChosenRef.current) return;
    setVisibility(defaultPublicFrom(profileRead.data) ? 'PUBLIC' : 'ANONYMOUS');
  }, [address, profileRead.data]);

  async function contribute() {
    setError('');
    if (!canContribute) {
      setError(
        configured
          ? goal.monthly?.phase === 'SETTLEMENT_DUE'
            ? 'Settle the elapsed monthly period before contributing again.'
            : 'This goal no longer accepts contributions.'
          : 'Contributions activate after the public deployment manifest is configured.',
      );
      return;
    }
    if (!isConnected || !address) {
      if (openConnectModal) {
        openConnectModal();
      } else {
        setError('Wallet connection options are not ready yet.');
      }
      return;
    }
    if (rawAmount <= 0n) {
      setError('Enter a contribution amount.');
      return;
    }
    try {
      if (!publicClient) throw new Error(`${activeDeployment.networkName} RPC is unavailable.`);
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      setState('checking-balance');
      const balance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      });
      if (balance < rawAmount) {
        setState('idle');
        setError(`Insufficient ${asset} balance for this contribution.`);
        return;
      }
      setState('approving');
      const approval = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [escrowAddress, rawAmount],
        chainId: activeChain.id,
      });
      setState('confirming-approval');
      requireSuccessfulReceipt(
        await publicClient.waitForTransactionReceipt({
          hash: approval,
          confirmations: APPROVAL_CONFIRMATIONS,
        }),
        'Token approval',
      );
      setState('contributing');
      const hash = await writeContractAsync({
        address: escrowAddress,
        abi: PRECOMMUNITY_ESCROW_ABI,
        functionName: 'contribute',
        args: [goal.chainGoalId, tokenAddress, rawAmount, visibility === 'PUBLIC'],
        chainId: activeChain.id,
      });
      setState('confirming-contribution');
      requireSuccessfulReceipt(
        await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: activeDeployment.confirmations,
        }),
        'Contribution',
      );
      setState('confirmed');
    } catch (reason) {
      setState('error');
      setError(reason instanceof Error ? reason.message.split('\n')[0]! : 'Transaction failed');
    }
  }

  return (
    <section className="border border-line bg-white p-[18px]" aria-labelledby="contribute-title">
      <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
        Direct to escrow
      </span>
      <h2 className="my-1 text-[22px]" id="contribute-title">
        Fund this goal
      </h2>
      <p className="mt-0 text-xs text-muted">
        Contributions are non-refundable, separated by asset and visible after{' '}
        {activeDeployment.confirmations} confirmations.
      </p>
      <div className="my-[18px] mb-3.5 flex border-b border-line" aria-label="Contribution asset">
        {available.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={asset === item}
            className={`flex-1 cursor-pointer border-0 border-b-2 border-transparent bg-transparent p-2 ${asset === item ? 'border-blue text-blue' : ''}`}
            onClick={() => {
              setAsset(item);
              setState('idle');
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <label className="flex flex-wrap items-center gap-2 border-b border-navy">
        <span className="w-full text-[10px] text-muted">Amount</span>
        <input
          className="min-w-0 flex-1 border-0 bg-transparent px-0 pt-1 pb-2 text-[22px] font-mono outline-none"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0"
          disabled={!canContribute}
        />
        <strong className="shrink-0 text-blue">{asset}</strong>
      </label>
      <div className="my-4 grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
        <span className="text-[11px] font-bold">Public credit</span>
        <ActionButton
          type="button"
          size="compact"
          variant={visibility === 'PUBLIC' ? 'primary' : 'secondary'}
          aria-pressed={visibility === 'PUBLIC'}
          onClick={() => {
            visibilityChosenRef.current = true;
            setVisibility('PUBLIC');
          }}
        >
          Show profile
        </ActionButton>
        <ActionButton
          type="button"
          size="compact"
          variant={visibility === 'ANONYMOUS' ? 'primary' : 'secondary'}
          aria-pressed={visibility === 'ANONYMOUS'}
          onClick={() => {
            visibilityChosenRef.current = true;
            setVisibility('ANONYMOUS');
          }}
        >
          Anonymous
        </ActionButton>
      </div>
      <dl className="mb-4 text-[10px]">
        <div className="flex justify-between gap-4 border-b border-line py-[7px]">
          <dt className="text-muted">Network</dt>
          <dd className="m-0 font-mono text-right break-all">{activeDeployment.networkName}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-line py-[7px]">
          <dt className="text-muted">Estimated gas</dt>
          <dd className="m-0 font-mono text-right break-all">{gas}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-line py-[7px]">
          <dt className="text-muted">Flow</dt>
          <dd className="m-0 font-mono text-right break-all">Approve + contribute</dd>
        </div>
      </dl>
      <ActionButton
        variant={goal.status !== 'OPEN' ? 'danger' : 'primary'}
        className="w-full"
        icon={
          state === 'approving' ||
          state === 'checking-balance' ||
          state === 'confirming-approval' ||
          state === 'contributing' ||
          state === 'confirming-contribution' ? (
            <LoaderCircle className="animate-spin" size={18} />
          ) : state === 'confirmed' ? (
            <Check size={18} />
          ) : goal.status !== 'OPEN' ? (
            <CircleX size={18} />
          ) : (
            <ShieldCheck size={18} />
          )
        }
        onClick={contribute}
        disabled={
          !canContribute ||
          walletIsRestoring ||
          connectModalOpen ||
          state === 'approving' ||
          state === 'checking-balance' ||
          state === 'confirming-approval' ||
          state === 'contributing' ||
          state === 'confirming-contribution' ||
          state === 'confirmed'
        }
      >
        {!configured
          ? 'Awaiting deployment'
          : goal.status !== 'OPEN'
            ? 'Goal is closed'
            : walletIsRestoring
              ? 'Restoring wallet…'
              : connectModalOpen
                ? 'Choose wallet…'
                : !isConnected || !address
                  ? 'Connect wallet to contribute'
                  : state === 'checking-balance'
                    ? 'Checking token balance…'
                    : state === 'approving'
                      ? 'Approve token in wallet…'
                      : state === 'confirming-approval' || state === 'confirming-contribution'
                        ? 'Awaiting confirmation…'
                        : state === 'contributing'
                          ? 'Confirm contribution in wallet…'
                          : state === 'confirmed'
                            ? 'Contribution confirmed'
                            : `Contribute ${asset}`}
      </ActionButton>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
