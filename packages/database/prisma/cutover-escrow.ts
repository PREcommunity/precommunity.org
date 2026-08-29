import { loadEnvFile } from 'node:process';
import path from 'node:path';
import {
  escrowCutoverDeploymentEnvKeys,
  escrowCutoverBlockers,
  hasEscrowCutoverBlockers,
  resetForEscrowCutover,
} from '../src/escrow-cutover';
import { createPrismaClient } from '../src/client';

try {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const network = process.env.PRECOMMUNITY_NETWORK;
if (network !== 'base' && network !== 'base-sepolia') {
  throw new Error('PRECOMMUNITY_NETWORK must be base or base-sepolia.');
}
const chainId = network === 'base' ? 8453 : 84532;
const deploymentEnvKeys = escrowCutoverDeploymentEnvKeys(network);
const newEscrowAddress = process.env[deploymentEnvKeys.escrowAddress]?.toLowerCase() ?? '';
if (!/^0x[a-f0-9]{40}$/.test(newEscrowAddress) || /^0x0{40}$/.test(newEscrowAddress)) {
  throw new Error(`${deploymentEnvKeys.escrowAddress} must be a non-zero contract address.`);
}
const newDeploymentBlock = process.env[deploymentEnvKeys.escrowDeploymentBlock] ?? '';
if (!/^[1-9]\d*$/.test(newDeploymentBlock)) {
  throw new Error(`${deploymentEnvKeys.escrowDeploymentBlock} must be a positive integer.`);
}
for (const key of [
  deploymentEnvKeys.preAddress,
  deploymentEnvKeys.usdcAddress,
  deploymentEnvKeys.initialOwnerAddress,
  deploymentEnvKeys.treasuryAddress,
]) {
  const value = process.env[key]?.toLowerCase() ?? '';
  if (!/^0x[a-f0-9]{40}$/.test(value) || /^0x0{40}$/.test(value)) {
    throw new Error(`${key} must be a non-zero manifest address.`);
  }
}

const expectedApproval = `${chainId}:${newEscrowAddress}`;
if (process.env.ALLOW_ESCROW_CUTOVER_RESET !== expectedApproval) {
  throw new Error(`Set ALLOW_ESCROW_CUTOVER_RESET=${expectedApproval} for this exact deployment.`);
}
if (process.env.ESCROW_CUTOVER_BACKUP_VERIFIED !== 'yes') {
  throw new Error('Set ESCROW_CUTOVER_BACKUP_VERIFIED=yes only after verifying the backup.');
}
if (process.env.ESCROW_CUTOVER_LIABILITIES_VERIFIED !== 'zero') {
  throw new Error(
    'Set ESCROW_CUTOVER_LIABILITIES_VERIFIED=zero only after checking that the old deployment has no goals, accounted balances or active Safe proposals.',
  );
}

const prisma = createPrismaClient();

async function main() {
  const blockers = await escrowCutoverBlockers(prisma, chainId!);
  if (hasEscrowCutoverBlockers(blockers)) {
    throw new Error(`Cutover blockers remain: ${JSON.stringify(blockers)}`);
  }
  const reset = await prisma.$transaction((tx) =>
    resetForEscrowCutover(tx, {
      chainId: chainId!,
      newEscrowAddress,
      newDeploymentBlock,
    }),
  );
  process.stdout.write(
    `${JSON.stringify({ chainId, newEscrowAddress, newDeploymentBlock, reset }, null, 2)}\n`,
  );
}

main().finally(() => prisma.$disconnect());
