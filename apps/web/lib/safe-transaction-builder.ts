import { OperationType } from '@safe-global/types-kit';
import { getAddress, isAddress, isHex } from 'viem';
import type { AdminManualSafeExport } from './admin-workspace-types';

export function safeTransactionBuilderFile(
  request: AdminManualSafeExport,
  ownerAddress: string,
  createdAt = Date.now(),
) {
  if (!Number.isSafeInteger(request.chainId) || request.chainId <= 0) {
    throw new Error('The manual Safe export has an invalid chain ID.');
  }
  if (!isAddress(request.safeAddress) || !isAddress(ownerAddress)) {
    throw new Error('The manual Safe export has an invalid Safe or owner address.');
  }
  if (!request.transactions.length) {
    throw new Error('The manual Safe export does not contain any transactions.');
  }

  const transactions = request.transactions.map((transaction) => {
    if (transaction.chainId !== request.chainId) {
      throw new Error('A manual Safe transaction belongs to a different chain.');
    }
    if (transaction.operation !== OperationType.Call) {
      throw new Error('Safe Transaction Builder exports cannot contain DelegateCall.');
    }
    if (
      !isAddress(transaction.to) ||
      !/^\d+$/.test(transaction.value) ||
      !isHex(transaction.data)
    ) {
      throw new Error('A manual Safe transaction is malformed.');
    }
    return {
      to: getAddress(transaction.to),
      value: transaction.value,
      data: transaction.data,
    };
  });

  return {
    version: '1.0' as const,
    chainId: String(request.chainId),
    createdAt,
    meta: {
      name: request.name,
      description: request.description,
      createdFromSafeAddress: getAddress(request.safeAddress),
      createdFromOwnerAddress: getAddress(ownerAddress),
    },
    transactions,
  };
}

export function serializeSafeTransactionBuilderFile(
  request: AdminManualSafeExport,
  ownerAddress: string,
  createdAt = Date.now(),
) {
  return `${JSON.stringify(safeTransactionBuilderFile(request, ownerAddress, createdAt), null, 2)}\n`;
}

export function safeTransactionBuilderFilename(request: AdminManualSafeExport) {
  const slug = request.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `safe-${slug || 'transactions'}-${request.chainId}.json`;
}

export function safeTransactionBuilderArtifact(
  request: AdminManualSafeExport,
  ownerAddress: string,
  createdAt = Date.now(),
) {
  return {
    filename: safeTransactionBuilderFilename(request),
    json: serializeSafeTransactionBuilderFile(request, ownerAddress, createdAt),
  };
}
