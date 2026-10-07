'use client';

import { PRE_DECIMALS, type AdCampaignView, type AdRevisionView } from '@precommunity/shared';
import {
  ArrowLeft,
  ArrowUpRight,
  Ban,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { erc20Abi, formatUnits, getAddress, isAddressEqual, parseUnits } from 'viem';
import { useConfig, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi';
import { getAccount } from 'wagmi/actions';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { useKeywordMarketRefresh } from '@/hooks/use-keyword-market-refresh';
import { AUTH_CHANGED_EVENT, AUTH_SIGN_IN_REQUESTED_EVENT } from '@/lib/auth-events';
import { activeChain, activeDeployment, activeExplorerTransaction } from '@/lib/deployment';
import {
  createAdRevision,
  getAdTransactionProjection,
  getKeywordMarketStatus,
  getMyAdCampaigns,
  isAdTransactionIndexed,
  type KeywordMarketChainSnapshot,
  type KeywordMarketTransaction,
  prepareAdStakeBid,
  prepareAdUnstake,
  prepareAdUnstakeRequest,
  setAdCampaignPaused,
} from '@/lib/keyword-market-api';
import { ApiError } from '@/lib/http';
import { requireSuccessfulReceipt } from '@/lib/transactions';
import { ActionButton } from './action-button';
import { FormFieldError, useFormValidation } from './form-validation';
import { KeywordMarketCreativePreview } from './keyword-market-creative-preview';

function statusTone(status: AdRevisionView['status']) {
  if (status === 'APPROVED') return 'success';
  if (status === 'PENDING_REVIEW') return 'warning';
  if (status === 'REJECTED' || status === 'SUSPENDED') return 'danger';
  return 'muted';
}

function count(value: string) {
  try {
    return new Intl.NumberFormat('en').format(BigInt(value));
  } catch {
    return value;
  }
}

function formatPre(raw: string | null | undefined) {
  if (raw === null || raw === undefined) return '—';
  try {
    return `${formatUnits(BigInt(raw), PRE_DECIMALS)} PRE`;
  } catch {
    return '—';
  }
}

function formatUsdBid(raw: string | null | undefined) {
  if (raw === null || raw === undefined) return '—';
  try {
    return `$${formatUnits(BigInt(raw), 6)} / click`;
  } catch {
    return '—';
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function KeywordMarketCampaignDetail({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<AdCampaignView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'missing' | 'error'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [action, setAction] = useState('');
  const [amount, setAmount] = useState('');
  const [bidUsd, setBidUsd] = useState('');
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [chainSnapshot, setChainSnapshot] = useState<KeywordMarketChainSnapshot | null>(null);
  const [transactionMessage, setTransactionMessage] = useState('');
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
  const [editing, setEditing] = useState(false);
  const [creative, setCreative] = useState({ headline: '', description: '', destinationUrl: '' });
  const loadInFlight = useRef(false);
  const pendingLoad = useRef<(() => Promise<void>) | null>(null);
  const validation = useFormValidation();
  const wallet = useWalletSession();
  const walletConfig = useConfig();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();

  const load = useCallback(
    async function loadCampaign(background = false): Promise<void> {
      if (loadInFlight.current) {
        if (!background) pendingLoad.current = () => loadCampaign();
        return;
      }
      loadInFlight.current = true;
      if (!background) {
        setState('loading');
        setError('');
      }
      try {
        const [campaigns, snapshot] = await Promise.all([
          getMyAdCampaigns(),
          getKeywordMarketStatus(),
        ]);
        const selected = campaigns.find((item) => item.id === campaignId) ?? null;
        setCampaign(selected);
        if (!background && selected?.position?.bidUsdRaw) {
          setBidUsd((current) => current || formatUnits(BigInt(selected.position!.bidUsdRaw), 6));
        }
        setChainSnapshot(snapshot);
        setState(selected ? 'ready' : 'missing');
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          setState('signed-out');
          return;
        }
        if (!background) {
          setError(reason instanceof Error ? reason.message : 'Campaign could not be loaded.');
          setState('error');
        }
      } finally {
        loadInFlight.current = false;
        const pending = pendingLoad.current;
        pendingLoad.current = null;
        void pending?.();
      }
    },
    [campaignId],
  );

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
  }, [load]);
  useKeywordMarketRefresh(load, state === 'ready' && !action);

  useEffect(() => {
    const timer = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const preview = useMemo(
    () => campaign?.activeRevision ?? campaign?.revisions[0] ?? null,
    [campaign],
  );

  function beginRevision() {
    const source = campaign?.activeRevision ?? campaign?.revisions[0];
    setCreative({
      headline: source?.headline ?? '',
      description: source?.description ?? '',
      destinationUrl: source?.destinationUrl ?? '',
    });
    setEditing(true);
  }

  async function togglePause() {
    if (!campaign) return;
    setAction('pause');
    setError('');
    try {
      await setAdCampaignPaused(campaign.id, !campaign.paused);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Campaign state could not be changed.');
    } finally {
      setAction('');
    }
  }

  async function submitRevision(event: React.FormEvent) {
    event.preventDefault();
    if (!campaign) return;
    setAction('revision');
    setError('');
    try {
      await createAdRevision(campaign.id, creative);
      setEditing(false);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Creative revision could not be submitted.',
      );
    } finally {
      setAction('');
    }
  }

  function validateTransaction(
    transaction: KeywordMarketTransaction,
    expectedAddress?: string | null,
  ) {
    if (transaction.chainId !== activeChain.id) {
      throw new Error(`The transaction was prepared for chain ${transaction.chainId}.`);
    }
    if (BigInt(transaction.valueRaw) !== 0n) {
      throw new Error('Keyword Market transactions must not transfer native currency.');
    }
    if (
      expectedAddress &&
      !isAddressEqual(getAddress(transaction.to), getAddress(expectedAddress))
    ) {
      throw new Error('The API and app use different Keyword Market contract addresses.');
    }
  }

  async function sendPreparedTransaction(
    transaction: KeywordMarketTransaction,
    label: string,
    stakerAddress: `0x${string}`,
  ) {
    if (!publicClient) throw new Error(`${activeDeployment.networkName} RPC is unavailable.`);
    const connected = getAccount(walletConfig);
    if (
      !connected.isConnected ||
      !connected.address ||
      !isAddressEqual(connected.address, stakerAddress)
    ) {
      throw new Error('The wallet account changed. Reconnect the campaign wallet and try again.');
    }
    const hash = await sendTransactionAsync({
      account: stakerAddress,
      to: getAddress(transaction.to),
      data: transaction.data,
      value: BigInt(transaction.valueRaw),
      chainId: activeChain.id,
    });
    setTransactionHash(hash);
    const receipt = requireSuccessfulReceipt(
      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: activeDeployment.confirmations,
      }),
      label,
    );
    setTransactionHash(receipt.transactionHash);
    return { hash: receipt.transactionHash, receipt };
  }

  async function waitForIndexedPosition(
    hash: `0x${string}`,
    receipt: { blockNumber: bigint; blockHash: string },
  ) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (!loadInFlight.current) {
        loadInFlight.current = true;
        try {
          // Read the committed cursor first so the following DB view includes that scan.
          const snapshot = await getKeywordMarketStatus();
          const campaigns = await getMyAdCampaigns();
          const projection = await getAdTransactionProjection(hash);
          const selected = campaigns.find((item) => item.id === campaignId) ?? null;
          setChainSnapshot(snapshot);
          if (selected) {
            setCampaign(selected);
            if (isAdTransactionIndexed(selected, snapshot, projection, receipt)) return true;
          }
        } catch (reason) {
          if (
            !(reason instanceof ApiError) ||
            (reason.status !== 0 && reason.status !== 429 && reason.status < 500)
          ) {
            throw reason;
          }
        } finally {
          loadInFlight.current = false;
          const pending = pendingLoad.current;
          pendingLoad.current = null;
          void pending?.();
        }
      }
      await delay(2_000);
    }
    return false;
  }

  async function submitStake(operation: 'STAKE' | 'REQUEST_UNSTAKE' | 'UNSTAKE') {
    if (!campaign || !chainSnapshot) return;
    setError('');
    setTransactionHash(null);
    setTransactionMessage('');

    if (
      !chainSnapshot.contractAddress ||
      (operation === 'STAKE' &&
        (campaign.chainStatus !== 'SYNCED' || !chainSnapshot.transactionsEnabled))
    ) {
      setError(
        !chainSnapshot.contractAddress
          ? 'Keyword Market contract is not configured.'
          : campaign.chainStatus !== 'SYNCED'
            ? 'Keyword Market is still syncing. Try staking again after its status becomes SYNCED.'
            : 'New stakes are unavailable while the market is paused.',
      );
      return;
    }
    if (!wallet.isConnected || !wallet.address) {
      wallet.connectAndAuthenticate();
      return;
    }
    if (
      !wallet.sessionAddress ||
      !isAddressEqual(getAddress(wallet.address), getAddress(wallet.sessionAddress))
    ) {
      setError('Sign in again with the wallet connected to this campaign.');
      return;
    }

    const stakerAddress = getAddress(wallet.address);
    let amountRaw = 0n;
    let bidUsdRaw = 0n;
    if (operation === 'STAKE') {
      try {
        amountRaw = parseUnits(amount.trim() || '0', PRE_DECIMALS);
        bidUsdRaw = parseUnits(bidUsd.trim(), 6);
      } catch {
        setError('Enter a valid PRE amount and USD bid with at most 6 decimal places.');
        return;
      }
      if (amountRaw < 0n || bidUsdRaw <= 0n) {
        setError('The PRE amount cannot be negative and the USD bid must be positive.');
        return;
      }
      if (
        BigInt(campaign.position?.stakeRaw ?? '0') === 0n &&
        chainSnapshot.minimumStakeRaw &&
        amountRaw < BigInt(chainSnapshot.minimumStakeRaw)
      ) {
        setError(`A new position requires at least ${formatPre(chainSnapshot.minimumStakeRaw)}.`);
        return;
      }
    }

    let confirmed = false;
    try {
      if (!publicClient) throw new Error(`${activeDeployment.networkName} RPC is unavailable.`);
      setAction('preparing-stake');
      setTransactionMessage('Preparing the on-chain operation…');
      if (wallet.chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });

      const plan =
        operation === 'STAKE'
          ? await prepareAdStakeBid(campaign.id, amountRaw.toString(), bidUsdRaw.toString())
          : operation === 'REQUEST_UNSTAKE'
            ? await prepareAdUnstakeRequest(campaign.id)
            : await prepareAdUnstake(campaign.id);
      if (!plan.enabled) {
        throw new Error(
          `Keyword Market transactions are unavailable while status is ${plan.status}.`,
        );
      }

      validateTransaction(plan.transaction, chainSnapshot.contractAddress);
      if (
        !isAddressEqual(getAddress(plan.tokenAddress), getAddress(chainSnapshot.preTokenAddress))
      ) {
        throw new Error('The API and app use different PRE token addresses.');
      }
      let transaction = plan.transaction;

      if (amountRaw > 0n) {
        const [balance, allowance] = await Promise.all([
          publicClient.readContract({
            address: getAddress(plan.tokenAddress),
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [stakerAddress],
          }),
          publicClient.readContract({
            address: getAddress(plan.tokenAddress),
            abi: erc20Abi,
            functionName: 'allowance',
            args: [stakerAddress, getAddress(plan.transaction.to)],
          }),
        ]);
        if (balance < amountRaw) throw new Error('Insufficient PRE balance for this operation.');
        if (allowance < amountRaw) {
          if (!plan.approvalTransaction) {
            throw new Error('PRE allowance changed. Prepare the operation again.');
          }
          validateTransaction(plan.approvalTransaction, plan.tokenAddress);
          setAction('approving-stake');
          setTransactionMessage('Approve PRE spending in your wallet…');
          await sendPreparedTransaction(plan.approvalTransaction, 'PRE approval', stakerAddress);
          const refreshed = await prepareAdStakeBid(
            campaign.id,
            amountRaw.toString(),
            bidUsdRaw.toString(),
          );
          if (!refreshed.enabled) {
            throw new Error(
              `Keyword Market staking is unavailable while status is ${refreshed.status}.`,
            );
          }
          validateTransaction(refreshed.transaction, chainSnapshot.contractAddress);
          if (!isAddressEqual(getAddress(refreshed.tokenAddress), getAddress(plan.tokenAddress))) {
            throw new Error('The PRE token address changed while preparing the stake.');
          }
          transaction = refreshed.transaction;
        }
      }

      setAction('sending-stake');
      setTransactionMessage(
        operation === 'UNSTAKE'
          ? 'Confirm withdrawal of the remaining PRE in your wallet…'
          : operation === 'REQUEST_UNSTAKE'
            ? 'Confirm the unstake request in your wallet…'
            : 'Confirm the stake transaction in your wallet…',
      );
      const { hash, receipt } = await sendPreparedTransaction(
        transaction,
        'Keyword Market transaction',
        stakerAddress,
      );
      confirmed = true;
      if (operation === 'STAKE') setAmount('');
      setAction('indexing-stake');
      setTransactionMessage('Transaction confirmed. Waiting for the marketplace index…');
      const indexed = await waitForIndexedPosition(hash, receipt);
      setTransactionMessage(
        indexed
          ? 'Position updated and indexed.'
          : 'Transaction is confirmed. Indexing is taking longer than usual; this page will keep refreshing while visible.',
      );
    } catch (reason) {
      if (confirmed) {
        setTransactionMessage(
          'Transaction confirmed. Marketplace data is temporarily unavailable; this page will keep refreshing while visible.',
        );
      } else {
        setError(reason instanceof Error ? reason.message.split('\n')[0]! : 'Transaction failed.');
        setTransactionMessage('');
      }
    } finally {
      setAction('');
    }
  }

  if (state !== 'ready' || !campaign) {
    return (
      <main className="keyword-market-app-shell">
        <Link className="keyword-market-back-link" href="/keyword-market/campaigns">
          <ArrowLeft size={14} /> Campaigns
        </Link>
        <div
          className={`keyword-market-access-state ${state === 'error' ? 'keyword-market-error-state' : ''}`}
        >
          {state === 'loading' ? <LoaderCircle className="animate-spin" /> : null}
          {state === 'signed-out' ? <WalletCards /> : null}
          {state === 'missing' || state === 'error' ? <CircleAlert /> : null}
          <strong>
            {state === 'loading'
              ? 'Loading campaign…'
              : state === 'signed-out'
                ? 'Sign in with the campaign wallet'
                : state === 'missing'
                  ? 'Campaign not found'
                  : 'Campaign unavailable'}
          </strong>
          {error ? <p>{error}</p> : null}
          {state === 'signed-out' ? (
            <ActionButton
              variant="primary"
              onClick={() => window.dispatchEvent(new Event(AUTH_SIGN_IN_REQUESTED_EVENT))}
            >
              Connect and sign in
            </ActionButton>
          ) : null}
        </div>
      </main>
    );
  }

  const withdrawAvailableAt = Number(campaign.position?.withdrawAvailableAt ?? '0');
  const withdrawalPending = withdrawAvailableAt > 0;
  const canWithdraw = withdrawalPending && nowSeconds >= withdrawAvailableAt;
  const hasStake = BigInt(campaign.position?.stakeRaw ?? '0') > 0n;

  return (
    <main className="keyword-market-app-shell">
      <header className="keyword-market-page-heading keyword-market-campaign-heading">
        <div>
          <Link className="keyword-market-back-link" href="/keyword-market/campaigns">
            <ArrowLeft size={14} /> Campaigns
          </Link>
          <span className="keyword-market-eyebrow">Keyword campaign</span>
          <h1>{campaign.keyword}</h1>
          <div className="keyword-market-heading-meta">
            <span
              className={`keyword-market-status ${campaign.paused ? 'keyword-market-status-muted' : 'keyword-market-status-success'}`}
            >
              {campaign.paused ? 'Paused' : 'Active campaign'}
            </span>
            <span>{campaign.chainStatus.replaceAll('_', ' ')}</span>
            <span>Updated {new Date(campaign.updatedAt).toLocaleDateString('en-GB')}</span>
          </div>
        </div>
        <div className="keyword-market-heading-actions">
          <ActionButton
            icon={campaign.paused ? <Play size={15} /> : <Pause size={15} />}
            onClick={() => void togglePause()}
            disabled={action === 'pause'}
          >
            {campaign.paused ? 'Resume' : 'Pause'}
          </ActionButton>
          <ActionButton variant="primary" icon={<Plus size={15} />} onClick={beginRevision}>
            New creative
          </ActionButton>
        </div>
      </header>

      {error ? <div className="keyword-market-inline-error">{error}</div> : null}

      <section className="keyword-market-campaign-overview">
        <div className="keyword-market-campaign-primary">
          <header className="keyword-market-section-heading">
            <div>
              <span className="keyword-market-eyebrow">Current result</span>
              <h2>Creative</h2>
            </div>
            {preview ? (
              <span
                className={`keyword-market-status keyword-market-status-${statusTone(preview.status)}`}
              >
                {preview.status.replaceAll('_', ' ')}
              </span>
            ) : null}
          </header>
          {preview ? (
            <KeywordMarketCreativePreview creative={preview} keyword={campaign.keyword} />
          ) : (
            <div className="keyword-market-empty-state">
              No creative revision has been submitted.
            </div>
          )}
          {campaign.pendingRevision && campaign.activeRevision ? (
            <div className="keyword-market-info-strip">
              <Clock3 size={15} /> Revision {campaign.pendingRevision.version} is pending. The
              approved revision remains live.
            </div>
          ) : null}
        </div>

        <aside className="keyword-market-stake-panel">
          <span className="keyword-market-eyebrow">Keyword position</span>
          <div className="keyword-market-rank-number">
            {campaign.position?.eligible ? `#${campaign.position.rank}` : '—'}
          </div>
          <dl>
            <div>
              <dt>Your stake</dt>
              <dd>{formatPre(campaign.position?.stakeRaw ?? '0')}</dd>
            </div>
            <div>
              <dt>Your bid</dt>
              <dd>{formatUsdBid(campaign.position?.bidUsdRaw)}</dd>
            </div>
            <div>
              <dt>Leader bid</dt>
              <dd>{formatUsdBid(campaign.leaderBidUsdRaw)}</dd>
            </div>
            <div>
              <dt>Bid increase to lead</dt>
              <dd>{formatUsdBid(campaign.bidNeededToLeadUsdRaw)}</dd>
            </div>
          </dl>
          {withdrawalPending ? (
            <p className="keyword-market-awaiting-note">
              <Clock3 size={14} /> Withdrawal available{' '}
              {new Date(withdrawAvailableAt * 1000).toLocaleString('en-GB')}. The offer has left the
              ranking; earlier clicks may still be charged.
            </p>
          ) : campaign.position && !campaign.position.eligible ? (
            <p className="keyword-market-awaiting-note">
              Add PRE to meet the minimum stake before the offer can rejoin the ranking.
            </p>
          ) : null}
          <label className="keyword-market-stake-entry">
            <span>Amount to add</span>
            <span className="keyword-market-stake-input">
              <input
                aria-label="PRE amount to add"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0"
                disabled={campaign.chainStatus !== 'SYNCED' || withdrawalPending || Boolean(action)}
              />
              <strong>PRE</strong>
            </span>
          </label>
          <label className="keyword-market-stake-entry">
            <span>Bid per click</span>
            <span className="keyword-market-stake-input">
              <input
                aria-label="USD bid per click"
                inputMode="decimal"
                value={bidUsd}
                onChange={(event) => setBidUsd(event.target.value)}
                placeholder="0.10"
                disabled={campaign.chainStatus !== 'SYNCED' || withdrawalPending || Boolean(action)}
              />
              <strong>USD</strong>
            </span>
          </label>
          {hasStake && !withdrawalPending ? (
            <small className="keyword-market-stake-minimum">
              Leave the PRE amount at 0 to update only your bid.
            </small>
          ) : null}
          {!hasStake && chainSnapshot?.minimumStakeRaw ? (
            <small className="keyword-market-stake-minimum">
              Minimum new position: {formatPre(chainSnapshot.minimumStakeRaw)}
            </small>
          ) : null}
          <div className="keyword-market-stake-actions" aria-label="Stake actions">
            <ActionButton
              variant="primary"
              disabled={
                withdrawalPending ||
                campaign.chainStatus !== 'SYNCED' ||
                !chainSnapshot?.transactionsEnabled ||
                Boolean(action)
              }
              onClick={() => void submitStake('STAKE')}
            >
              {hasStake ? 'Update stake / bid' : 'Stake'}
            </ActionButton>
            <ActionButton
              disabled={
                !hasStake || withdrawalPending || !chainSnapshot?.contractAddress || Boolean(action)
              }
              onClick={() => void submitStake('REQUEST_UNSTAKE')}
            >
              Request unstake
            </ActionButton>
            <ActionButton
              variant="danger"
              disabled={!canWithdraw || !chainSnapshot?.contractAddress || Boolean(action)}
              onClick={() => void submitStake('UNSTAKE')}
            >
              Withdraw PRE
            </ActionButton>
          </div>
          <p className="keyword-market-awaiting-note">
            {campaign.chainStatus === 'SYNCED' ? null : campaign.chainStatus === 'SYNCING' ? (
              <LoaderCircle className="animate-spin" size={14} />
            ) : (
              <Ban size={14} />
            )}
            {campaign.chainStatus === 'SYNCED'
              ? `Ready on ${activeDeployment.networkName}`
              : chainSnapshot?.contractAddress
                ? `${campaign.chainStatus.replaceAll('_', ' ')} — new stakes unavailable; withdrawals remain available`
                : `${campaign.chainStatus.replaceAll('_', ' ')} — transactions disabled`}
          </p>
          {transactionMessage ? (
            <p className="keyword-market-transaction-note">
              {action ? <LoaderCircle className="animate-spin" size={14} /> : null}
              {transactionMessage}
              {transactionHash ? (
                <a
                  href={activeExplorerTransaction(transactionHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
              ) : null}
            </p>
          ) : null}
          <Link
            className="keyword-market-text-link"
            href={`/keyword-market/keywords/${encodeURIComponent(campaign.keyword)}`}
          >
            Open public ranking <ArrowUpRight size={14} />
          </Link>
        </aside>
      </section>

      {editing ? (
        <form
          className="keyword-market-revision-editor"
          onSubmit={submitRevision}
          onInvalid={validation.onInvalid}
          onInput={validation.onInput}
        >
          <header className="keyword-market-section-heading">
            <div>
              <span className="keyword-market-eyebrow">Immutable version</span>
              <h2>Submit a new creative</h2>
            </div>
            <button
              className="keyword-market-text-button"
              type="button"
              onClick={() => setEditing(false)}
            >
              Close
            </button>
          </header>
          <div className="keyword-market-revision-grid">
            <div className="keyword-market-editor-fields">
              <label className="keyword-market-field">
                <span>
                  Headline <small>{creative.headline.length}/60</small>
                </span>
                <input
                  value={creative.headline}
                  maxLength={60}
                  onChange={(event) =>
                    setCreative((value) => ({ ...value, headline: event.target.value }))
                  }
                />
              </label>
              <label className="keyword-market-field">
                <span>
                  Description <small>{creative.description.length}/160</small>
                </span>
                <textarea
                  {...validation.fieldProps('description')}
                  value={creative.description}
                  maxLength={160}
                  required
                  onChange={(event) =>
                    setCreative((value) => ({ ...value, description: event.target.value }))
                  }
                />
                <FormFieldError {...validation.errorProps('description')} />
              </label>
              <label className="keyword-market-field">
                <span>HTTPS destination</span>
                <input
                  {...validation.fieldProps('destinationUrl')}
                  type="url"
                  pattern="https://.*"
                  value={creative.destinationUrl}
                  maxLength={2048}
                  required
                  onChange={(event) =>
                    setCreative((value) => ({ ...value, destinationUrl: event.target.value }))
                  }
                />
                <FormFieldError {...validation.errorProps('destinationUrl')} />
              </label>
              <ActionButton
                type="submit"
                variant="primary"
                disabled={action === 'revision'}
                icon={
                  action === 'revision' ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : undefined
                }
              >
                {action === 'revision' ? 'Submitting…' : 'Submit for review'}
              </ActionButton>
            </div>
            <KeywordMarketCreativePreview
              creative={creative}
              keyword={campaign.keyword}
              placeholders
            />
          </div>
        </form>
      ) : null}

      <section className="keyword-market-detail-section">
        <header className="keyword-market-section-heading">
          <div>
            <span className="keyword-market-eyebrow">Performance</span>
            <h2>Resolution metrics</h2>
          </div>
        </header>
        <div className="keyword-market-metric-line">
          <div>
            <span>Last 30 days</span>
            <strong>{count(campaign.activeRevision?.last30DaysResolutions ?? '0')}</strong>
          </div>
          <div>
            <span>Lifetime</span>
            <strong>{count(campaign.activeRevision?.lifetimeResolutions ?? '0')}</strong>
          </div>
          <div>
            <span>Accounting</span>
            <strong>Non-billing</strong>
            <small>Resolver selections only</small>
          </div>
        </div>
      </section>

      <section className="keyword-market-detail-section">
        <header className="keyword-market-section-heading">
          <div>
            <span className="keyword-market-eyebrow">Moderation trail</span>
            <h2>Creative revisions</h2>
          </div>
        </header>
        <div className="keyword-market-revision-list">
          {campaign.revisions.map((revision) => (
            <div className="keyword-market-revision-row" key={revision.id}>
              <span>v{revision.version}</span>
              <div>
                <strong>{revision.headline}</strong>
                <small>{revision.displayDomain}</small>
              </div>
              <span
                className={`keyword-market-status keyword-market-status-${statusTone(revision.status)}`}
              >
                {revision.status.replaceAll('_', ' ')}
              </span>
              <span>{new Date(revision.createdAt).toLocaleDateString('en-GB')}</span>
              <span>{count(revision.lifetimeResolutions)} resolves</span>
              {revision.moderationNote ? <p>{revision.moderationNote}</p> : null}
            </div>
          ))}
        </div>
      </section>

      {campaign.position ? (
        <section className="keyword-market-detail-section">
          <header className="keyword-market-section-heading">
            <div>
              <span className="keyword-market-eyebrow">Chain evidence</span>
              <h2>Position proof</h2>
            </div>
          </header>
          <dl className="keyword-market-proof-list keyword-market-proof-list-wide">
            <div>
              <dt>Staker</dt>
              <dd>{campaign.position.stakerAddress}</dd>
            </div>
            <div>
              <dt>Amount since</dt>
              <dd>
                {campaign.position.amountSinceBlock}:{campaign.position.amountSinceLogIndex}
              </dd>
            </div>
            <div>
              <dt>Position block</dt>
              <dd>{campaign.position.positionBlock}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd>{campaign.position.positionTxHash}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </main>
  );
}
