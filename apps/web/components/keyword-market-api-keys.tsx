'use client';

import type { AdApiKeyView } from '@precommunity/shared';
import { CircleAlert, Copy, KeyRound, LoaderCircle, RefreshCw, WalletCards } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { AUTH_CHANGED_EVENT, AUTH_SIGN_IN_REQUESTED_EVENT } from '@/lib/auth-events';
import { ApiError } from '@/lib/http';
import { createAdApiKey, getAdApiKeys, revokeAdApiKey } from '@/lib/keyword-market-api';
import { canManageKeywordMarketApiKeys } from '@/lib/session-access';
import { ActionButton } from './action-button';
import { ConfirmationDialog } from './confirmation-dialog';

type AccessState = 'loading' | 'ready' | 'signed-out' | 'denied' | 'error';

export function KeywordMarketApiKeys() {
  const { sessionAddress, sessionReady, sessionRoles, isLoggingOut } = useWalletSession();
  const canManage = canManageKeywordMarketApiKeys(sessionRoles);
  const [keys, setKeys] = useState<AdApiKeyView[]>([]);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<{ id: string; name: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<AccessState>('loading');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<AdApiKeyView | null>(null);
  const generation = useRef(0);
  const secretGeneration = useRef(0);

  const clearSecret = useCallback(() => {
    secretGeneration.current += 1;
    setSecret(null);
    setCopied(false);
  }, []);

  const handleError = useCallback(
    (reason: unknown, fallback: string) => {
      if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
        clearSecret();
        setKeys([]);
        setRevoking(null);
        setState(reason.status === 401 ? 'signed-out' : 'denied');
      }
      setError(reason instanceof Error ? reason.message : fallback);
    },
    [clearSecret],
  );

  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!sessionReady || isLoggingOut || !sessionAddress || !canManage) return;
    setState('loading');
    setError('');
    try {
      const result = await getAdApiKeys();
      if (request !== generation.current) return;
      setKeys(result);
      setState('ready');
    } catch (reason) {
      if (request !== generation.current) return;
      setState('error');
      handleError(reason, 'API keys could not be loaded.');
    }
  }, [canManage, handleError, isLoggingOut, sessionAddress, sessionReady]);

  useEffect(() => {
    clearSecret();
    setKeys([]);
    setRevoking(null);
    setBusy('');
    void load();
    const authChanged = () => {
      clearSecret();
      setKeys([]);
      setRevoking(null);
      setBusy('');
      void load();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, authChanged);
    return () => {
      generation.current += 1;
      secretGeneration.current += 1;
      window.removeEventListener(AUTH_CHANGED_EVENT, authChanged);
    };
  }, [clearSecret, load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || secret) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
      setError('Enter a name between 1 and 80 characters.');
      return;
    }
    const request = generation.current;
    setBusy('create');
    setError('');
    try {
      const { apiKey, ...created } = await createAdApiKey(trimmed);
      if (request !== generation.current) return;
      setKeys((current) => [created, ...current]);
      setName('');
      secretGeneration.current += 1;
      setCopied(false);
      setSecret({ id: created.id, name: created.name, apiKey });
    } catch (reason) {
      if (request === generation.current) handleError(reason, 'API key could not be created.');
    } finally {
      if (request === generation.current) setBusy('');
    }
  }

  async function copySecret() {
    if (!secret) return;
    const request = secretGeneration.current;
    setError('');
    try {
      await navigator.clipboard.writeText(secret.apiKey);
      if (request === secretGeneration.current) setCopied(true);
    } catch {
      if (request === secretGeneration.current) {
        setError('Could not copy the key. Select it and copy it manually.');
      }
    }
  }

  async function revoke() {
    if (!revoking || busy) return;
    const request = generation.current;
    setBusy(revoking.id);
    setError('');
    try {
      await revokeAdApiKey(revoking.id);
      if (request !== generation.current) return;
      if (secret?.id === revoking.id) clearSecret();
      setRevoking(null);
      setBusy('');
      await load();
    } catch (reason) {
      if (request === generation.current) handleError(reason, 'API key could not be revoked.');
    } finally {
      if (request === generation.current) setBusy('');
    }
  }

  const access: AccessState = !sessionReady
    ? 'loading'
    : isLoggingOut || !sessionAddress
      ? 'signed-out'
      : !canManage
        ? 'denied'
        : state;

  return (
    <main className="keyword-market-app-shell">
      <header className="keyword-market-page-heading keyword-market-page-heading-compact">
        <div>
          <span className="keyword-market-eyebrow">SUPER_ADMIN · Search engine integrations</span>
          <h1>API keys.</h1>
          <p>Create a separate named key for each search engine. Keep keys on its server.</p>
        </div>
        {access === 'ready' ? (
          <ActionButton
            icon={<RefreshCw size={15} />}
            disabled={Boolean(busy)}
            onClick={() => void load()}
          >
            Refresh
          </ActionButton>
        ) : null}
      </header>
      {error ? (
        <div className="keyword-market-inline-error" role="alert">
          {error}
        </div>
      ) : null}
      {access !== 'ready' ? (
        <div className="keyword-market-access-state">
          {access === 'loading' ? <LoaderCircle className="animate-spin" /> : null}
          {access === 'signed-out' ? <WalletCards /> : null}
          {access === 'denied' || access === 'error' ? <CircleAlert /> : null}
          <strong>
            {access === 'loading'
              ? 'Checking API key access…'
              : access === 'signed-out'
                ? 'Sign in to manage API keys'
                : access === 'denied'
                  ? 'SUPER_ADMIN access required'
                  : 'API keys could not be loaded'}
          </strong>
          {access === 'signed-out' ? (
            <ActionButton
              variant="primary"
              onClick={() => window.dispatchEvent(new Event(AUTH_SIGN_IN_REQUESTED_EVENT))}
            >
              Connect and sign in
            </ActionButton>
          ) : null}
          {access === 'error' ? (
            <ActionButton onClick={() => void load()}>Retry</ActionButton>
          ) : null}
        </div>
      ) : (
        <>
          <section className="keyword-market-admin-section">
            <form className="flex max-w-xl flex-wrap items-end gap-3" onSubmit={create}>
              <label className="keyword-market-field min-w-0 flex-1">
                <span>Search engine name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={80}
                  placeholder="Search engine name"
                  disabled={Boolean(busy) || Boolean(secret)}
                />
              </label>
              <ActionButton
                type="submit"
                variant="primary"
                disabled={Boolean(busy) || Boolean(secret)}
                icon={
                  busy === 'create' ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <KeyRound size={15} />
                  )
                }
              >
                {busy === 'create' ? 'Creating…' : 'Create key'}
              </ActionButton>
            </form>
            {secret ? (
              <div className="mt-6 border border-line bg-blue-soft p-5" role="status">
                <strong>Save the key for {secret.name}</strong>
                <p className="mt-2 text-muted">
                  This is the only time the full key is shown. It cannot be recovered after closing.
                </p>
                <label className="keyword-market-field mt-4">
                  <span>New API key</span>
                  <input
                    readOnly
                    value={secret.apiKey}
                    onFocus={(event) => event.currentTarget.select()}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                </label>
                <div className="keyword-market-form-actions mt-4">
                  <ActionButton
                    type="button"
                    icon={<Copy size={15} />}
                    onClick={() => void copySecret()}
                  >
                    {copied ? 'Copied' : 'Copy key'}
                  </ActionButton>
                  <ActionButton type="button" onClick={clearSecret}>
                    Close
                  </ActionButton>
                </div>
              </div>
            ) : null}
          </section>
          <section className="keyword-market-admin-section">
            <header className="keyword-market-admin-section-heading">
              <h2>Search engine keys</h2>
              <span className="keyword-market-audit-total">{keys.length} keys</span>
            </header>
            {keys.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                  <thead className="border-b border-line font-mono text-[9px] uppercase text-muted">
                    <tr>
                      {['Name', 'Key prefix', 'Status', 'Created', 'Last used', 'Actions'].map(
                        (label) => (
                          <th className="px-3 py-3 font-normal" key={label} scope="col">
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key.id} className="border-b border-line">
                        <th scope="row" className="max-w-[220px] break-words px-3 py-4 font-bold">
                          {key.name}
                        </th>
                        <td className="px-3 py-4 font-mono">{key.prefix}…</td>
                        <td className="px-3 py-4">{key.revokedAt ? 'Revoked' : 'Active'}</td>
                        <td className="px-3 py-4">
                          <time dateTime={key.createdAt}>
                            {new Date(key.createdAt).toLocaleString('en-GB')}
                          </time>
                        </td>
                        <td className="px-3 py-4">
                          {key.lastUsedAt ? (
                            <time dateTime={key.lastUsedAt}>
                              {new Date(key.lastUsedAt).toLocaleString('en-GB')}
                            </time>
                          ) : (
                            'Never'
                          )}
                        </td>
                        <td className="px-3 py-4">
                          {!key.revokedAt ? (
                            <ActionButton
                              type="button"
                              variant="danger"
                              size="compact"
                              disabled={Boolean(busy)}
                              onClick={() => setRevoking(key)}
                            >
                              Revoke
                            </ActionButton>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="keyword-market-empty-state">
                <KeyRound />
                <strong>No API keys yet</strong>
                <p>Create a named key for your first search engine.</p>
              </div>
            )}
          </section>
        </>
      )}
      <ConfirmationDialog
        open={access === 'ready' && Boolean(revoking)}
        title="Revoke API key?"
        description={`The search engine using ${revoking?.name ?? 'this key'} will lose access immediately. Other keys will keep working.`}
        confirmLabel="Revoke key"
        pending={Boolean(busy)}
        onCancel={() => setRevoking(null)}
        onConfirm={() => void revoke()}
      />
    </main>
  );
}
