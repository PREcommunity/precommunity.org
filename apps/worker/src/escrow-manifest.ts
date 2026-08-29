import { PRECOMMUNITY_ESCROW_ABI, type DeploymentManifest } from '@precommunity/shared';
import { getAddress, type Account, type Chain, type PublicClient, type Transport } from 'viem';

const zeroAddress = '0x0000000000000000000000000000000000000000';
const expectedMonthlyScheduleVersion = 1n;
const expectedMinFirstSettlementDelay = 7n * 24n * 60n * 60n;
const expectedMaxFirstSettlementDelay = 60n * 24n * 60n * 60n;

function normalizedAddress(value: unknown, label: string) {
  try {
    return getAddress(String(value)).toLowerCase();
  } catch {
    throw new Error(`Escrow ${label} returned an invalid address`);
  }
}

function assertAddress(label: string, actual: unknown, expected: string) {
  const normalizedActual = normalizedAddress(actual, label);
  if (normalizedActual !== getAddress(expected).toLowerCase()) {
    throw new Error(
      `Escrow ${label} mismatch: expected ${expected.toLowerCase()}, received ${normalizedActual}`,
    );
  }
  return normalizedActual;
}

/**
 * Verifies the immutable escrow identity before any projection is written.
 * The current owner may already be the configured Safe, but the deployment-block
 * OwnershipTransferred event must still identify the manifest's initial owner.
 */
export async function verifyEscrowManifest<
  transport extends Transport,
  chain extends Chain | undefined,
  account extends Account | undefined,
>(
  client: PublicClient<transport, chain, account>,
  manifest: DeploymentManifest,
  configuredSafeAddress?: string | null,
) {
  const address = getAddress(manifest.escrowAddress);
  const deploymentBlock = BigInt(manifest.deploymentBlock);
  const [
    chainId,
    bytecode,
    pre,
    usdc,
    treasury,
    currentOwner,
    settlementLimit,
    scheduleVersion,
    minFirstSettlementDelay,
    maxFirstSettlementDelay,
    ownerEvents,
  ] = await Promise.all([
    client.getChainId(),
    client.getBytecode({ address, blockNumber: deploymentBlock }),
    client.readContract({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'PRE',
    }),
    client.readContract({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'USDC',
    }),
    client.readContract({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'TREASURY',
    }),
    client.readContract({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'owner',
    }),
    client.readContract({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'MAX_MONTHLY_PERIODS_PER_SETTLEMENT',
    }),
    client.readContract({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'MONTHLY_SCHEDULE_VERSION',
    }),
    client.readContract({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'MIN_FIRST_SETTLEMENT_DELAY',
    }),
    client.readContract({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      functionName: 'MAX_FIRST_SETTLEMENT_DELAY',
    }),
    client.getContractEvents({
      address,
      abi: PRECOMMUNITY_ESCROW_ABI,
      eventName: 'OwnershipTransferred',
      fromBlock: deploymentBlock,
      toBlock: deploymentBlock,
      strict: true,
    }),
  ]);

  if (chainId !== manifest.chainId) {
    throw new Error(`Escrow chain mismatch: expected ${manifest.chainId}, received ${chainId}`);
  }
  if (!bytecode || bytecode === '0x') {
    throw new Error('Escrow bytecode is missing at the configured deployment block');
  }
  assertAddress('PRE', pre, manifest.preAddress);
  assertAddress('USDC', usdc, manifest.usdcAddress);
  assertAddress('TREASURY', treasury, manifest.treasury);
  if (BigInt(String(settlementLimit)) !== 24n) {
    throw new Error(
      `Escrow settlement limit mismatch: expected 24, received ${String(settlementLimit)}`,
    );
  }
  if (BigInt(String(scheduleVersion)) !== expectedMonthlyScheduleVersion) {
    throw new Error(
      `Escrow monthly schedule version mismatch: expected ${expectedMonthlyScheduleVersion}, received ${String(scheduleVersion)}`,
    );
  }
  if (BigInt(String(minFirstSettlementDelay)) !== expectedMinFirstSettlementDelay) {
    throw new Error(
      `Escrow minimum first settlement delay mismatch: expected ${expectedMinFirstSettlementDelay}, received ${String(minFirstSettlementDelay)}`,
    );
  }
  if (BigInt(String(maxFirstSettlementDelay)) !== expectedMaxFirstSettlementDelay) {
    throw new Error(
      `Escrow maximum first settlement delay mismatch: expected ${expectedMaxFirstSettlementDelay}, received ${String(maxFirstSettlementDelay)}`,
    );
  }

  const expectedInitialOwner = getAddress(manifest.owner).toLowerCase();
  const hasInitialOwnerProof = ownerEvents.some((event) => {
    const args = event.args as { previousOwner?: unknown; newOwner?: unknown };
    return (
      normalizedAddress(args.previousOwner, 'initial previous owner') === zeroAddress &&
      normalizedAddress(args.newOwner, 'initial owner') === expectedInitialOwner
    );
  });
  if (!hasInitialOwnerProof) {
    throw new Error('Escrow initial owner does not match the deployment-block event');
  }

  const normalizedCurrentOwner = normalizedAddress(currentOwner, 'owner');
  const allowedCurrentOwners = new Set([
    expectedInitialOwner,
    ...(configuredSafeAddress ? [getAddress(configuredSafeAddress).toLowerCase()] : []),
  ]);
  if (!allowedCurrentOwners.has(normalizedCurrentOwner)) {
    throw new Error(
      `Escrow current owner ${normalizedCurrentOwner} is neither the manifest owner nor the configured Safe`,
    );
  }

  return {
    chainId,
    address: address.toLowerCase(),
    deploymentBlock: deploymentBlock.toString(),
    preAddress: normalizedAddress(pre, 'PRE'),
    usdcAddress: normalizedAddress(usdc, 'USDC'),
    treasuryAddress: normalizedAddress(treasury, 'TREASURY'),
    initialOwner: expectedInitialOwner,
    currentOwner: normalizedCurrentOwner,
    maxPeriodsPerSettlement: 24,
    monthlyScheduleVersion: Number(expectedMonthlyScheduleVersion),
    minFirstSettlementDelaySeconds: Number(expectedMinFirstSettlementDelay),
    maxFirstSettlementDelaySeconds: Number(expectedMaxFirstSettlementDelay),
  };
}
