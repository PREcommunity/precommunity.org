// Generated from ../escrow. Run packages/shared/scripts/sync-escrow-abi.mjs to refresh.
export const PRECOMMUNITY_ESCROW_ABI = [
  {
    inputs: [
      {
        internalType: 'address',
        name: 'initialOwner',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'pre',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'usdc',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'projectTreasury',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [],
    name: 'CancelledFundsLimitExceeded',
    type: 'error',
  },
  {
    inputs: [],
    name: 'DescriptionTooLong',
    type: 'error',
  },
  {
    inputs: [],
    name: 'EnforcedPause',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ExcessBalanceUnavailable',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ExpectedPause',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ExpenseLimitExceeded',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'firstSettlementAt',
        type: 'uint64',
      },
    ],
    name: 'FirstSettlementNotUtcMidnight',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'firstSettlementAt',
        type: 'uint64',
      },
      {
        internalType: 'uint256',
        name: 'minimum',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'maximum',
        type: 'uint256',
      },
    ],
    name: 'FirstSettlementOutOfRange',
    type: 'error',
  },
  {
    inputs: [],
    name: 'FundingChannelDisabled',
    type: 'error',
  },
  {
    inputs: [],
    name: 'GoalAlreadyExists',
    type: 'error',
  },
  {
    inputs: [],
    name: 'GoalExpired',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'manager',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'limit',
        type: 'uint256',
      },
    ],
    name: 'GoalManagerLimitReached',
    type: 'error',
  },
  {
    inputs: [],
    name: 'GoalNotCancelled',
    type: 'error',
  },
  {
    inputs: [],
    name: 'GoalNotClosed',
    type: 'error',
  },
  {
    inputs: [],
    name: 'GoalNotOpen',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'controller',
        type: 'address',
      },
    ],
    name: 'InvalidControllerAddress',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidDeadline',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidGoal',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'enum PREcommunityEscrowV1.GoalType',
        name: 'expected',
        type: 'uint8',
      },
      {
        internalType: 'enum PREcommunityEscrowV1.GoalType',
        name: 'actual',
        type: 'uint8',
      },
    ],
    name: 'InvalidGoalType',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidMetadataURI',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidPayoutAddress',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidProfileAvatarURI',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidProfileDisplayName',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidProfileWebsiteURL',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 'requested',
        type: 'uint8',
      },
      {
        internalType: 'uint8',
        name: 'maximum',
        type: 'uint8',
      },
    ],
    name: 'InvalidSettlementLimit',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidTitle',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidTokenContract',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        internalType: 'uint8',
        name: 'expected',
        type: 'uint8',
      },
      {
        internalType: 'uint8',
        name: 'actual',
        type: 'uint8',
      },
    ],
    name: 'InvalidTokenDecimals',
    type: 'error',
  },
  {
    inputs: [],
    name: 'MonthlyGoalStopping',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'endsAt',
        type: 'uint64',
      },
    ],
    name: 'MonthlyPeriodNotEnded',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint64',
        name: 'endedAt',
        type: 'uint64',
      },
    ],
    name: 'MonthlySettlementRequired',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    name: 'OwnableInvalidOwner',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'OwnableUnauthorizedAccount',
    type: 'error',
  },
  {
    inputs: [],
    name: 'OwnershipRenunciationDisabled',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ProfileBioTooLong',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ReentrancyGuardReentrantCall',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
    ],
    name: 'SafeERC20FailedOperation',
    type: 'error',
  },
  {
    inputs: [],
    name: 'TransferAmountMismatch',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'UnauthorizedGoalController',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'UnauthorizedGoalManager',
    type: 'error',
  },
  {
    inputs: [],
    name: 'UnauthorizedPayoutController',
    type: 'error',
  },
  {
    inputs: [],
    name: 'UnauthorizedRelease',
    type: 'error',
  },
  {
    inputs: [],
    name: 'UnsupportedToken',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ZeroAddress',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ZeroAmount',
    type: 'error',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'treasury',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'payoutRecipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'CancelledFundsReleased',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'contributor',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'bool',
        name: 'profileVisible',
        type: 'bool',
      },
    ],
    name: 'ContributionReceived',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'ExcessTokenRecovered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'payoutRecipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'ExpenseReleased',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
    ],
    name: 'GoalCancelled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'preRecipientEntitlement',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'usdcRecipientEntitlement',
        type: 'uint256',
      },
    ],
    name: 'GoalClosed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'creator',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'payoutRecipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'preTarget',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'usdcTarget',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'deadline',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'string',
        name: 'title',
        type: 'string',
      },
      {
        indexed: false,
        internalType: 'string',
        name: 'description',
        type: 'string',
      },
      {
        indexed: false,
        internalType: 'string',
        name: 'metadataURI',
        type: 'string',
      },
    ],
    name: 'GoalCreated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'bool',
        name: 'enabled',
        type: 'bool',
      },
    ],
    name: 'GoalManagerUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'previousPayout',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newPayout',
        type: 'address',
      },
    ],
    name: 'GoalPayoutUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint256',
        name: 'previousLimit',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'newLimit',
        type: 'uint256',
      },
    ],
    name: 'MaxOpenGoalsPerManagerUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'preTreasuryEntitlementAdded',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'usdcTreasuryEntitlementAdded',
        type: 'uint256',
      },
    ],
    name: 'MonthlyGoalCancelled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'uint64',
        name: 'periodStart',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'periodEnd',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'uint8',
        name: 'settlementDay',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'enum PREcommunityEscrowV1.SurplusPolicy',
        name: 'surplusPolicy',
        type: 'uint8',
      },
    ],
    name: 'MonthlyGoalCreated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'uint64',
        name: 'periodEnd',
        type: 'uint64',
      },
    ],
    name: 'MonthlyGoalStopRequested',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'uint32',
        name: 'periodIndex',
        type: 'uint32',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'periodStart',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'periodEnd',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'enum PREcommunityEscrowV1.SurplusPolicy',
        name: 'surplusPolicy',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'bool',
        name: 'finalPeriod',
        type: 'bool',
      },
    ],
    name: 'MonthlyPeriodSettled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'enum PREcommunityEscrowV1.SurplusPolicy',
        name: 'previousPolicy',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'enum PREcommunityEscrowV1.SurplusPolicy',
        name: 'newPolicy',
        type: 'uint8',
      },
    ],
    name: 'MonthlySurplusPolicyUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'uint32',
        name: 'periodIndex',
        type: 'uint32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'periodContributed',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'carryIn',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'recipientEntitlementAdded',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'carryOut',
        type: 'uint256',
      },
    ],
    name: 'MonthlyTokenSettled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousOwner',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferStarted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousOwner',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferred',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'Paused',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'uint64',
        name: 'revision',
        type: 'uint64',
      },
    ],
    name: 'ProfileCleared',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'uint64',
        name: 'revision',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'string',
        name: 'displayName',
        type: 'string',
      },
      {
        indexed: false,
        internalType: 'string',
        name: 'websiteUrl',
        type: 'string',
      },
      {
        indexed: false,
        internalType: 'string',
        name: 'bio',
        type: 'string',
      },
      {
        indexed: false,
        internalType: 'string',
        name: 'avatarURI',
        type: 'string',
      },
      {
        indexed: false,
        internalType: 'bool',
        name: 'defaultPublic',
        type: 'bool',
      },
    ],
    name: 'ProfileUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousPayout',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newPayout',
        type: 'address',
      },
    ],
    name: 'TreasuryPayoutUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'Unpaused',
    type: 'event',
  },
  {
    inputs: [],
    name: 'MAX_DESCRIPTION_BYTES',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_FIRST_SETTLEMENT_DELAY',
    outputs: [
      {
        internalType: 'uint64',
        name: '',
        type: 'uint64',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_METADATA_URI_BYTES',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_MONTHLY_PERIODS_PER_SETTLEMENT',
    outputs: [
      {
        internalType: 'uint8',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_PROFILE_AVATAR_URI_BYTES',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_PROFILE_BIO_BYTES',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_PROFILE_NAME_BYTES',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_PROFILE_URL_BYTES',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_TITLE_BYTES',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MIN_FIRST_SETTLEMENT_DELAY',
    outputs: [
      {
        internalType: 'uint64',
        name: '',
        type: 'uint64',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MONTHLY_SCHEDULE_VERSION',
    outputs: [
      {
        internalType: 'uint8',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'PRE',
    outputs: [
      {
        internalType: 'contract IERC20',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'TREASURY',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'USDC',
    outputs: [
      {
        internalType: 'contract IERC20',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'acceptOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
    ],
    name: 'accountedByToken',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
    ],
    name: 'cancelGoal',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
    ],
    name: 'cancelMonthlyGoal',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'clearProfile',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
    ],
    name: 'closeGoal',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        internalType: 'bool',
        name: 'profileVisible',
        type: 'bool',
      },
    ],
    name: 'contribute',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'preTarget',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'usdcTarget',
        type: 'uint256',
      },
      {
        internalType: 'uint64',
        name: 'deadline',
        type: 'uint64',
      },
      {
        internalType: 'string',
        name: 'title',
        type: 'string',
      },
      {
        internalType: 'string',
        name: 'description',
        type: 'string',
      },
      {
        internalType: 'string',
        name: 'metadataURI',
        type: 'string',
      },
    ],
    name: 'createGoal',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'preMonthlyTarget',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'usdcMonthlyTarget',
        type: 'uint256',
      },
      {
        internalType: 'uint64',
        name: 'firstSettlementAt',
        type: 'uint64',
      },
      {
        internalType: 'enum PREcommunityEscrowV1.SurplusPolicy',
        name: 'surplusPolicy',
        type: 'uint8',
      },
      {
        internalType: 'string',
        name: 'title',
        type: 'string',
      },
      {
        internalType: 'string',
        name: 'description',
        type: 'string',
      },
      {
        internalType: 'string',
        name: 'metadataURI',
        type: 'string',
      },
    ],
    name: 'createMonthlyGoal',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'getProfile',
    outputs: [
      {
        components: [
          {
            internalType: 'bool',
            name: 'active',
            type: 'bool',
          },
          {
            internalType: 'uint64',
            name: 'revision',
            type: 'uint64',
          },
          {
            internalType: 'string',
            name: 'displayName',
            type: 'string',
          },
          {
            internalType: 'string',
            name: 'websiteUrl',
            type: 'string',
          },
          {
            internalType: 'string',
            name: 'bio',
            type: 'string',
          },
          {
            internalType: 'string',
            name: 'avatarURI',
            type: 'string',
          },
          {
            internalType: 'bool',
            name: 'defaultPublic',
            type: 'bool',
          },
        ],
        internalType: 'struct PREcommunityEscrowV1.CommunityProfile',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
    ],
    name: 'goal',
    outputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'creator',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'recipient',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'payoutRecipient',
            type: 'address',
          },
          {
            internalType: 'uint64',
            name: 'deadline',
            type: 'uint64',
          },
          {
            internalType: 'enum PREcommunityEscrowV1.GoalType',
            name: 'goalType',
            type: 'uint8',
          },
          {
            internalType: 'enum PREcommunityEscrowV1.GoalStatus',
            name: 'status',
            type: 'uint8',
          },
          {
            internalType: 'uint256',
            name: 'preTarget',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'usdcTarget',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'preContributed',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'usdcContributed',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'preRecipientEntitlement',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'usdcRecipientEntitlement',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'preReleasedExpense',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'usdcReleasedExpense',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'preTreasuryEntitlement',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'usdcTreasuryEntitlement',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'preReleasedCancelledFunds',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'usdcReleasedCancelledFunds',
            type: 'uint256',
          },
          {
            internalType: 'string',
            name: 'title',
            type: 'string',
          },
          {
            internalType: 'string',
            name: 'description',
            type: 'string',
          },
          {
            internalType: 'string',
            name: 'metadataURI',
            type: 'string',
          },
        ],
        internalType: 'struct PREcommunityEscrowV1.Goal',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'goalManagers',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'maxOpenGoalsPerManager',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
    ],
    name: 'monthlyGoal',
    outputs: [
      {
        components: [
          {
            internalType: 'uint64',
            name: 'periodStart',
            type: 'uint64',
          },
          {
            internalType: 'uint32',
            name: 'periodsSettled',
            type: 'uint32',
          },
          {
            internalType: 'uint8',
            name: 'settlementDay',
            type: 'uint8',
          },
          {
            internalType: 'enum PREcommunityEscrowV1.SurplusPolicy',
            name: 'surplusPolicy',
            type: 'uint8',
          },
          {
            internalType: 'bool',
            name: 'stopRequested',
            type: 'bool',
          },
          {
            internalType: 'uint256',
            name: 'preCurrentContributed',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'usdcCurrentContributed',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'preCarry',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'usdcCarry',
            type: 'uint256',
          },
        ],
        internalType: 'struct PREcommunityEscrowV1.MonthlyGoal',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'creator',
        type: 'address',
      },
    ],
    name: 'openGoalCountByCreator',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'pause',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'paused',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'pendingOwner',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'recoverExcessToken',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'releaseCancelledFunds',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'releaseExpense',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
    ],
    name: 'requestMonthlyGoalStop',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
      {
        internalType: 'bool',
        name: 'enabled',
        type: 'bool',
      },
    ],
    name: 'setGoalManager',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'newPayout',
        type: 'address',
      },
    ],
    name: 'setGoalPayout',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'newLimit',
        type: 'uint256',
      },
    ],
    name: 'setMaxOpenGoalsPerManager',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'enum PREcommunityEscrowV1.SurplusPolicy',
        name: 'newPolicy',
        type: 'uint8',
      },
    ],
    name: 'setMonthlySurplusPolicy',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'string',
        name: 'displayName',
        type: 'string',
      },
      {
        internalType: 'string',
        name: 'websiteUrl',
        type: 'string',
      },
      {
        internalType: 'string',
        name: 'bio',
        type: 'string',
      },
      {
        internalType: 'string',
        name: 'avatarURI',
        type: 'string',
      },
      {
        internalType: 'bool',
        name: 'defaultPublic',
        type: 'bool',
      },
    ],
    name: 'setProfile',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'newPayout',
        type: 'address',
      },
    ],
    name: 'setTreasuryPayout',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'goalId',
        type: 'bytes32',
      },
      {
        internalType: 'uint8',
        name: 'maxPeriods',
        type: 'uint8',
      },
    ],
    name: 'settleMonthlyGoal',
    outputs: [
      {
        internalType: 'uint8',
        name: 'periodsProcessed',
        type: 'uint8',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'treasuryPayout',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'unpause',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
