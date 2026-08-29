import {
  ChainAuthorityKind,
  GoalManagerAssignmentSource,
  type GoalManagerAssignment,
  type Prisma,
} from './generated/prisma/client';

type GoalManagerAssignmentDatabase = Pick<
  Prisma.TransactionClient,
  'chainAuthority' | 'goalManagerAssignment'
>;

export interface GoalManagerAssignmentScope {
  chainId: number;
  contractAddress: string;
  safeOwners: string[];
}

function normalizedAddresses(addresses: readonly string[]) {
  return [...new Set(addresses.map((address) => address.toLowerCase()))].sort();
}

export async function reconcileSafeOwnerGoalManagerAssignments(
  database: GoalManagerAssignmentDatabase,
  input: GoalManagerAssignmentScope,
) {
  const contractAddress = input.contractAddress.toLowerCase();
  const safeOwners = normalizedAddresses(input.safeOwners);
  const scope = { chainId: input.chainId, contractAddress };
  const [actualManagers, existingAssignments] = await Promise.all([
    database.chainAuthority.findMany({
      where: { ...scope, kind: ChainAuthorityKind.GOAL_MANAGER },
      select: { address: true },
    }),
    database.goalManagerAssignment.findMany({ where: scope }),
  ]);
  const assignedAddresses = new Set(
    existingAssignments.map((assignment) => assignment.address.toLowerCase()),
  );
  const safeOwnerSet = new Set(safeOwners);

  await database.goalManagerAssignment.updateMany({
    where: {
      ...scope,
      source: GoalManagerAssignmentSource.SAFE_OWNER,
      desiredEnabled: true,
      ...(safeOwners.length ? { address: { notIn: safeOwners } } : {}),
    },
    data: { desiredEnabled: false },
  });

  for (const address of safeOwners) {
    await database.goalManagerAssignment.upsert({
      where: {
        chainId_contractAddress_address_source: {
          ...scope,
          address,
          source: GoalManagerAssignmentSource.SAFE_OWNER,
        },
      },
      update: { desiredEnabled: true },
      create: {
        ...scope,
        address,
        source: GoalManagerAssignmentSource.SAFE_OWNER,
        desiredEnabled: true,
      },
    });
  }

  // Existing non-Safe managers predate desired-state tracking. Preserve them as
  // explicit manual assignments instead of revoking authority during rollout.
  let preservedLegacyManagers = 0;
  for (const manager of actualManagers) {
    const address = manager.address.toLowerCase();
    if (safeOwnerSet.has(address) || assignedAddresses.has(address)) continue;
    await database.goalManagerAssignment.upsert({
      where: {
        chainId_contractAddress_address_source: {
          ...scope,
          address,
          source: GoalManagerAssignmentSource.MANUAL,
        },
      },
      update: {},
      create: {
        ...scope,
        address,
        source: GoalManagerAssignmentSource.MANUAL,
        desiredEnabled: true,
      },
    });
    preservedLegacyManagers += 1;
  }

  return { safeOwners: safeOwners.length, preservedLegacyManagers };
}

export function desiredGoalManagerSet(
  safeOwners: readonly string[],
  actualManagers: readonly string[],
  assignments: readonly Pick<GoalManagerAssignment, 'address' | 'desiredEnabled'>[],
) {
  const desired = new Set(normalizedAddresses(safeOwners));
  const addressesWithPolicy = new Set(
    assignments.map((assignment) => assignment.address.toLowerCase()),
  );
  for (const assignment of assignments) {
    if (assignment.desiredEnabled) desired.add(assignment.address.toLowerCase());
  }
  // Preserve legacy managers until reconciliation classifies them.
  for (const address of actualManagers) {
    const normalized = address.toLowerCase();
    if (!addressesWithPolicy.has(normalized)) desired.add(normalized);
  }
  return desired;
}
