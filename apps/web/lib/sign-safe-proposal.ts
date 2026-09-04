import Safe, { type Eip1193Provider } from '@safe-global/protocol-kit';
import type { Hex } from 'viem';
import type { AdminSafeContractCall, AdminSafeProposalSubmission } from './admin-workspace-types';

export async function signSafeProposal(
  provider: Eip1193Provider | undefined,
  signer: string,
  safeAddress: string,
  nonce: number,
  transactions: Pick<AdminSafeContractCall, 'to' | 'value' | 'data' | 'operation'>[],
): Promise<AdminSafeProposalSubmission> {
  if (!provider) throw new Error('The connected wallet provider is unavailable.');
  const protocolKit = await Safe.init({ provider, signer, safeAddress });
  const transaction = await protocolKit.createTransaction({ transactions, options: { nonce } });
  const safeTxHash = (await protocolKit.getTransactionHash(transaction)) as Hex;
  const signature = await protocolKit.signHash(safeTxHash);
  return {
    transaction: transaction.data,
    safeTxHash,
    senderAddress: signer as Hex,
    senderSignature: signature.data as Hex,
  };
}
