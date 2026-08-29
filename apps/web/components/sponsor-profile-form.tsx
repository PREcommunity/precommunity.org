'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, Trash2, UserRound } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import {
  PRECOMMUNITY_ESCROW_ABI,
  isDeploymentConfigured,
  isValidIpfsUri,
} from '@precommunity/shared';
import { getAddress } from 'viem';
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { activeChain, activeDeployment, activeExplorerTransaction } from '@/lib/deployment';
import { requireSuccessfulReceipt } from '@/lib/transactions';
import {
  formLabelClass,
  formLabelTextClass,
  selectClass,
  textInputClass,
  textareaClass,
} from './form-control-classes';
import { FormFieldError, useFormValidation } from './form-validation';

const zeroAddress = '0x0000000000000000000000000000000000000000' as const;

type ProfileForm = {
  displayName: string;
  websiteUrl: string;
  bio: string;
  avatarUri: string;
  defaultPublic: boolean;
};

type OnchainProfile = ProfileForm & { active: boolean; revision: bigint };

const emptyProfile: ProfileForm = {
  displayName: '',
  websiteUrl: '',
  bio: '',
  avatarUri: '',
  defaultPublic: false,
};

function bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeProfile(value: unknown): OnchainProfile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Record<string, unknown>;
  return {
    active: Boolean(profile.active),
    revision: typeof profile.revision === 'bigint' ? profile.revision : 0n,
    displayName: String(profile.displayName ?? ''),
    websiteUrl: String(profile.websiteUrl ?? ''),
    bio: String(profile.bio ?? ''),
    avatarUri: String(profile.avatarURI ?? ''),
    defaultPublic: Boolean(profile.defaultPublic),
  };
}

export function SponsorProfileForm() {
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [status, setStatus] = useState<
    'idle' | 'submitting' | 'confirming' | 'saved' | 'clearing' | 'cleared'
  >('idle');
  const [transactionHash, setTransactionHash] = useState<`0x${string}`>();
  const [error, setError] = useState('');
  const validation = useFormValidation();
  const loadedProfileRef = useRef('');
  const { address, chainId, isConnected, status: accountStatus } = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: activeChain.id });
  const configured = isDeploymentConfigured(activeDeployment);
  const escrowAddress = getAddress(activeDeployment.escrowAddress);
  const walletRestoring = accountStatus === 'connecting' || accountStatus === 'reconnecting';
  const profileRead = useReadContract({
    address: escrowAddress,
    abi: PRECOMMUNITY_ESCROW_ABI,
    functionName: 'getProfile',
    args: [address ?? zeroAddress],
    chainId: activeChain.id,
    query: { enabled: configured && Boolean(address) },
  });
  const chainProfile = useMemo(() => normalizeProfile(profileRead.data), [profileRead.data]);

  useEffect(() => {
    loadedProfileRef.current = '';
    setProfile(emptyProfile);
    setStatus('idle');
    setTransactionHash(undefined);
    setError('');
  }, [address]);

  useEffect(() => {
    if (!address || !chainProfile) return;
    const key = `${address.toLowerCase()}:${chainProfile.revision.toString()}`;
    if (loadedProfileRef.current === key) return;
    loadedProfileRef.current = key;
    setProfile({
      displayName: chainProfile.displayName,
      websiteUrl: chainProfile.websiteUrl,
      bio: chainProfile.bio,
      avatarUri: chainProfile.avatarUri,
      defaultPublic: chainProfile.defaultPublic,
    });
  }, [address, chainProfile]);

  function validate() {
    const displayName = profile.displayName.trim();
    const websiteUrl = profile.websiteUrl.trim();
    const avatarUri = profile.avatarUri.trim();
    if (bytes(displayName) < 1 || bytes(displayName) > 80)
      return 'Display name must be 1–80 UTF-8 bytes.';
    if (
      websiteUrl &&
      (!websiteUrl.startsWith('https://') || bytes(websiteUrl) > 200 || websiteUrl === 'https://')
    )
      return 'Website must be an HTTPS URL up to 200 bytes.';
    if (bytes(profile.bio) > 500) return 'Bio must be at most 500 UTF-8 bytes.';
    if (avatarUri && (!isValidIpfsUri(avatarUri) || bytes(avatarUri) > 200))
      return 'Avatar must be a valid ipfs:// CID up to 200 bytes.';
    return '';
  }

  async function prepareWallet() {
    if (!isConnected || !address) {
      openConnectModal?.();
      return false;
    }
    if (!publicClient) throw new Error(`${activeDeployment.networkName} RPC is unavailable.`);
    if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
    return true;
  }

  async function waitForFinality(hash: `0x${string}`, label: string) {
    if (!publicClient) throw new Error(`${activeDeployment.networkName} RPC is unavailable.`);
    setTransactionHash(hash);
    setStatus('confirming');
    requireSuccessfulReceipt(
      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: activeDeployment.confirmations,
      }),
      label,
    );
    loadedProfileRef.current = '';
    await profileRead.refetch();
  }

  async function save() {
    setError('');
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      if (!(await prepareWallet())) return;
      setStatus('submitting');
      const hash = await writeContractAsync({
        address: escrowAddress,
        abi: PRECOMMUNITY_ESCROW_ABI,
        functionName: 'setProfile',
        args: [
          profile.displayName.trim(),
          profile.websiteUrl.trim(),
          profile.bio,
          profile.avatarUri.trim(),
          profile.defaultPublic,
        ],
        chainId: activeChain.id,
      });
      await waitForFinality(hash, 'Profile update');
      setStatus('saved');
    } catch (reason) {
      setStatus('idle');
      setError(
        reason instanceof Error ? reason.message.split('\n')[0]! : 'Profile transaction failed.',
      );
    }
  }

  async function clear() {
    setError('');
    try {
      if (!(await prepareWallet())) return;
      setStatus('clearing');
      const hash = await writeContractAsync({
        address: escrowAddress,
        abi: PRECOMMUNITY_ESCROW_ABI,
        functionName: 'clearProfile',
        chainId: activeChain.id,
      });
      await waitForFinality(hash, 'Profile clear');
      setProfile(emptyProfile);
      setStatus('cleared');
    } catch (reason) {
      setStatus('idle');
      setError(
        reason instanceof Error
          ? reason.message.split('\n')[0]!
          : 'Profile clear transaction failed.',
      );
    }
  }

  const transactionPending =
    status === 'submitting' || status === 'confirming' || status === 'clearing';

  return (
    <section className="px-[var(--page-pad)] pt-7 pb-[60px]">
      <header className="max-w-[780px]">
        <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">
          On-chain identity
        </span>
        <h1 className="mt-2.5 mb-2 text-[clamp(30px,4vw,42px)] leading-[1.05] tracking-[-.04em]">
          Your community profile.
        </h1>
        <p className="m-0 max-w-[760px] text-muted">
          Your wallet writes this public profile directly to escrow. The official UI shows it after{' '}
          {activeDeployment.confirmations} confirmations; no SIWE session is required.
        </p>
      </header>

      {!configured ||
      walletRestoring ||
      !isConnected ||
      !address ||
      profileRead.isPending ||
      profileRead.isError ? (
        <div className="my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center">
          {walletRestoring || profileRead.isPending ? (
            <LoaderCircle className="animate-spin" size={30} />
          ) : (
            <UserRound size={30} />
          )}
          <h2 className="mt-2.5 mb-1 text-2xl">
            {!configured
              ? 'Profile contract is awaiting deployment'
              : walletRestoring
                ? 'Restoring wallet connection…'
                : !isConnected || !address
                  ? 'Connect your wallet to edit your profile'
                  : profileRead.isError
                    ? 'Profile contract is temporarily unavailable'
                    : 'Reading profile from Base…'}
          </h2>
          {!isConnected || !address ? (
            <>
              <p className="text-muted">Only a wallet connection is needed.</p>
              <button
                className="cursor-pointer border border-navy bg-navy px-3 py-2 text-white"
                onClick={() => openConnectModal?.()}
                disabled={walletRestoring || connectModalOpen}
              >
                {connectModalOpen ? 'Choose wallet…' : 'Connect wallet'}
              </button>
            </>
          ) : null}
          {profileRead.isError ? (
            <>
              <p className="text-muted">The escrow profile could not be read.</p>
              <button
                className="cursor-pointer border border-navy bg-navy px-3 py-2 text-white"
                onClick={() => void profileRead.refetch()}
              >
                Retry
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-7 grid grid-cols-[minmax(0,1fr)_340px] gap-10 border-t border-line pt-9 max-[900px]:grid-cols-1">
          <form
            className="grid grid-cols-2 gap-3.5 max-sm:grid-cols-1"
            onInvalid={validation.onInvalid}
            onInput={validation.onInput}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className={formLabelClass}>
              <span className={formLabelTextClass}>Display name · 80 UTF-8 bytes</span>
              <input
                {...validation.fieldProps('displayName')}
                className={textInputClass}
                aria-label="Display name"
                value={profile.displayName}
                onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}
                placeholder="Organization or contributor"
                required
              />
              <FormFieldError {...validation.errorProps('displayName')} />
            </label>
            <label className={formLabelClass}>
              <span className={formLabelTextClass}>Public HTTPS URL · optional</span>
              <input
                {...validation.fieldProps('websiteUrl')}
                className={textInputClass}
                aria-label="Public URL"
                type="url"
                pattern="https://.+"
                value={profile.websiteUrl}
                onChange={(event) => setProfile({ ...profile, websiteUrl: event.target.value })}
                placeholder="https://example.org"
              />
              <FormFieldError {...validation.errorProps('websiteUrl')} />
            </label>
            <label className={`${formLabelClass} col-span-full max-sm:col-auto`}>
              <span className={formLabelTextClass}>Avatar IPFS URI · optional</span>
              <input
                {...validation.fieldProps('avatarUri')}
                className={textInputClass}
                aria-label="Avatar IPFS URI"
                value={profile.avatarUri}
                onChange={(event) => setProfile({ ...profile, avatarUri: event.target.value })}
                placeholder="ipfs://bafy…/avatar.webp"
                pattern="ipfs://(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:/\S*)?"
              />
              <FormFieldError {...validation.errorProps('avatarUri')} />
              <small>
                PNG, JPEG or WebP only. Paste an existing ipfs:// CID; v1 does not upload or pin
                files.
              </small>
            </label>
            <label className={`${formLabelClass} col-span-full max-sm:col-auto`}>
              <span className={formLabelTextClass}>Bio · 500 UTF-8 bytes</span>
              <textarea
                className={textareaClass}
                aria-label="Bio"
                value={profile.bio}
                onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
                placeholder="What do you work on in the ecosystem?"
              />
            </label>
            <label className={formLabelClass}>
              <span className={formLabelTextClass}>Default contribution visibility</span>
              <select
                className={selectClass}
                aria-label="Default contribution visibility"
                value={profile.defaultPublic ? 'PUBLIC' : 'ANONYMOUS'}
                onChange={(event) =>
                  setProfile({ ...profile, defaultPublic: event.target.value === 'PUBLIC' })
                }
              >
                <option value="ANONYMOUS">Anonymous</option>
                <option value="PUBLIC">Show profile</option>
              </select>
            </label>
            <button
              className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded border border-navy bg-navy px-3 font-bold text-white hover:border-blue hover:bg-blue hover:text-navy disabled:cursor-not-allowed disabled:opacity-55"
              disabled={transactionPending}
            >
              {transactionPending ? (
                <LoaderCircle className="animate-spin" size={17} />
              ) : status === 'saved' ? (
                <Check size={17} />
              ) : null}
              {status === 'submitting'
                ? 'Confirm in wallet…'
                : status === 'clearing'
                  ? 'Confirm clear in wallet…'
                  : status === 'confirming'
                    ? 'Awaiting confirmation…'
                    : status === 'saved'
                      ? 'Profile confirmed'
                      : 'Save profile on-chain'}
            </button>
            {chainProfile?.active ? (
              <button
                type="button"
                className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded border border-navy bg-white px-3 font-bold text-danger hover:bg-blue-soft disabled:cursor-not-allowed disabled:opacity-55"
                disabled={transactionPending}
                onClick={() => void clear()}
              >
                <Trash2 size={15} /> Clear on-chain profile
              </button>
            ) : null}
            {transactionHash ? (
              <a
                className="col-span-full flex items-center gap-2 border-l-2 border-blue bg-blue-soft px-3 py-2.5 text-xs max-sm:col-auto"
                href={activeExplorerTransaction(transactionHash)}
                target="_blank"
                rel="noreferrer"
              >
                Transaction {transactionHash.slice(0, 10)}… <ExternalLink size={13} />
              </a>
            ) : null}
            {status === 'cleared' ? (
              <p className="col-span-full my-3 flex items-center gap-2 border-l-2 border-blue bg-blue-soft px-3 py-2.5 text-xs max-sm:col-auto">
                <Check size={15} /> Profile clear confirmed.
              </p>
            ) : null}
            {error ? (
              <p className="col-span-full text-xs text-danger max-sm:col-auto" role="alert">
                {error}
              </p>
            ) : null}
          </form>
          <aside className="border-l border-line pl-6 max-sm:border-t max-sm:border-l-0 max-sm:px-0 max-sm:pt-5">
            <span className="text-[10px] text-muted uppercase">Public preview</span>
            <div className="my-4 grid size-16 place-items-center rounded-full bg-blue-soft">
              {profile.avatarUri ? <strong>IPFS</strong> : <UserRound size={28} />}
            </div>
            <strong className="block text-lg">{profile.displayName || 'Wallet member'}</strong>
            <p className="text-xs text-muted">{profile.bio || 'No public bio yet.'}</p>
            {profile.websiteUrl ? (
              <a
                className="inline-flex items-center gap-1.5 text-xs text-blue"
                href={profile.websiteUrl}
                target="_blank"
                rel="noreferrer"
              >
                Visit website <ExternalLink size={13} />
              </a>
            ) : (
              <small>No public URL</small>
            )}
            <p className="text-xs text-muted">
              {profile.defaultPublic
                ? 'Contributions public by default.'
                : 'Contributions anonymous by default.'}
            </p>
            <small>Current on-chain revision: {chainProfile?.revision.toString() ?? '0'}</small>
          </aside>
        </div>
      )}
    </section>
  );
}
