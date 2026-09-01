'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clipboard, Download, ExternalLink, FileJson, X } from 'lucide-react';
import type { AdminManualSafeExport } from '@/lib/admin-workspace-types';
import { safeTransactionBuilderArtifact } from '@/lib/safe-transaction-builder';
import { ActionButton } from './action-button';

function networkName(chainId: number) {
  if (chainId === 8453) return 'Base';
  if (chainId === 84532) return 'Base Sepolia';
  return `Chain ${chainId}`;
}

export function SafeManualTransactionDialog({
  request,
  ownerAddress,
  onClose,
}: {
  request: AdminManualSafeExport | null;
  ownerAddress: string;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const artifact = useMemo(() => {
    if (!request) return null;
    return safeTransactionBuilderArtifact(request, ownerAddress);
  }, [ownerAddress, request]);

  useEffect(() => {
    if (!request) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, request]);

  useEffect(() => {
    setCopied(false);
    setCopyError(null);
  }, [request]);

  if (!request || !artifact) return null;

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(artifact!.json);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopied(false);
      setCopyError('Clipboard access was denied. Download the JSON file instead.');
    }
  }

  function downloadJson() {
    const url = URL.createObjectURL(
      new Blob([artifact!.json], { type: 'application/json;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact!.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-100 grid place-items-center overflow-y-auto bg-navy/65 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="my-auto w-full max-w-[720px] border border-navy bg-paper p-5 shadow-[0_22px_50px_rgba(9,28,51,.28)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-safe-title"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="grid size-10 shrink-0 place-items-center bg-blue-soft text-blue">
            <FileJson size={20} />
          </span>
          <button
            ref={closeButtonRef}
            className="-mt-1 -mr-1 inline-flex size-8 cursor-pointer items-center justify-center border-0 bg-transparent text-muted hover:text-navy"
            type="button"
            aria-label="Close manual Safe export"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <h2 className="mt-4 mb-1 text-2xl" id="manual-safe-title">
          {request.name}
        </h2>
        <p className="mt-0 mb-4 text-[13px] leading-relaxed text-muted">{request.description}</p>

        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 border-y border-line py-3 text-xs max-sm:grid-cols-1 max-sm:gap-y-1">
          <dt className="text-muted">Network</dt>
          <dd className="m-0 font-medium">
            {networkName(request.chainId)} · chain ID {request.chainId}
          </dd>
          <dt className="text-muted">Safe</dt>
          <dd className="m-0 break-all font-mono">{request.safeAddress}</dd>
          <dt className="text-muted">Transactions</dt>
          <dd className="m-0">{request.transactions.length}</dd>
        </dl>

        <div className="mt-4 max-h-40 overflow-y-auto border border-line bg-white/50 p-3">
          {request.transactions.map((transaction, index) => (
            <div className="text-[11px] [&+&]:mt-3" key={`${transaction.to}-${index}`}>
              <strong className="block">Transaction {index + 1}</strong>
              <code className="mt-1 block break-all text-muted">to: {transaction.to}</code>
              <code className="block break-all text-muted">value: {transaction.value}</code>
              <code className="block break-all text-muted">data: {transaction.data}</code>
            </div>
          ))}
        </div>

        <p className="mt-3 mb-0 text-[11px] leading-relaxed text-muted">
          Import this file in Safe Transaction Builder, review every call, collect approvals and
          execute it in Safe Wallet. Approval counts remain visible in Safe Wallet only.
        </p>
        {copyError ? <p className="mt-2 mb-0 text-xs text-danger">{copyError}</p> : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <a
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-navy bg-white px-3 text-xs font-bold text-navy no-underline hover:border-blue hover:bg-blue-soft"
            href={request.queueUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Safe Wallet <ExternalLink size={14} />
          </a>
          <ActionButton
            type="button"
            icon={copied ? <Check size={15} /> : <Clipboard size={15} />}
            onClick={() => void copyJson()}
          >
            {copied ? 'JSON copied' : 'Copy JSON'}
          </ActionButton>
          <ActionButton
            variant="primary"
            type="button"
            icon={<Download size={15} />}
            onClick={downloadJson}
          >
            Download JSON
          </ActionButton>
        </div>
      </section>
    </div>
  );
}
