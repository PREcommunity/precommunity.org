// Generated from ../escrow. Run packages/shared/scripts/sync-escrow-abi.mjs to refresh.
export const PRE_KEYWORD_MARKET_ABI = [
  {
    inputs: [
      {
        internalType: 'address',
        name: 'initialOwner',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'preToken',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'initialMinimumStake',
        type: 'uint256',
      },
      {
        internalType: 'bool',
        name: 'startPaused',
        type: 'bool',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'requiredCoveragePre',
        type: 'uint256',
      },
    ],
    name: 'CoverageNotMet',
    type: 'error',
  },
  {
    inputs: [],
    name: 'EnforcedPause',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ExpectedPause',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'requested',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'available',
        type: 'uint256',
      },
    ],
    name: 'InsufficientAccruedFees',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidChargeId',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidOperator',
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
    name: 'PositionMissing',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'expected',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'actual',
        type: 'uint256',
      },
    ],
    name: 'PositionVersionMismatch',
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
    inputs: [
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'minimum',
        type: 'uint256',
      },
    ],
    name: 'StakeBelowMinimum',
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
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'UnauthorizedOperator',
    type: 'error',
  },
  {
    inputs: [],
    name: 'UnstakeAlreadyRequested',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'availableAt',
        type: 'uint256',
      },
    ],
    name: 'UnstakeNotReady',
    type: 'error',
  },
  {
    inputs: [],
    name: 'UnstakeNotRequested',
    type: 'error',
  },
  {
    inputs: [],
    name: 'UnstakePending',
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
    inputs: [],
    name: 'ZeroKeyword',
    type: 'error',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amountPre',
        type: 'uint256',
      },
    ],
    name: 'AccruedWithdrawn',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'previousBidUsd',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'newBidUsd',
        type: 'uint256',
      },
    ],
    name: 'BidUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint256',
        name: 'previousMinimum',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'newMinimum',
        type: 'uint256',
      },
    ],
    name: 'MinimumStakeUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousOperator',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newOperator',
        type: 'address',
      },
    ],
    name: 'OperatorUpdated',
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
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'bidUsd',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'bool',
        name: 'eligible',
        type: 'bool',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'newStake',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'positionVersion',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'previousStake',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'requiredCoveragePre',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'withdrawAvailableAt',
        type: 'uint256',
      },
    ],
    name: 'PositionChanged',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'chargeId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'requestedPre',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'chargedPre',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'remainingPre',
        type: 'uint256',
      },
    ],
    name: 'StakeCharged',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'depositedPre',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amountPre',
        type: 'uint256',
      },
    ],
    name: 'Staked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'bidUsd',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'previousStaker',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'previousBidUsd',
        type: 'uint256',
      },
    ],
    name: 'TopStakeChanged',
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
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'availableAt',
        type: 'uint256',
      },
    ],
    name: 'UnstakeRequested',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amountPre',
        type: 'uint256',
      },
    ],
    name: 'Unstaked',
    type: 'event',
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
    name: 'UNSTAKE_DELAY',
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
    name: 'acceptOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'accruedFees',
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
        name: 'chargeId',
        type: 'bytes32',
      },
    ],
    name: 'chargeProcessed',
    outputs: [
      {
        internalType: 'bool',
        name: 'processed',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'positionVersion',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'requestedPre',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: 'chargeId',
        type: 'bytes32',
      },
    ],
    name: 'chargeStake',
    outputs: [
      {
        internalType: 'uint256',
        name: 'chargedPre',
        type: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'minimumStake',
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
    name: 'operator',
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
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
    ],
    name: 'positionOf',
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
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
    ],
    name: 'requestUnstake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'newMinimumStake',
        type: 'uint256',
      },
    ],
    name: 'setMinimumStake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'newOperator',
        type: 'address',
      },
    ],
    name: 'setOperator',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        internalType: 'uint256',
        name: 'amountPre',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'bidUsd',
        type: 'uint256',
      },
    ],
    name: 'stake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'staker',
        type: 'address',
      },
    ],
    name: 'stakeDetailsOf',
    outputs: [
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'bidUsd',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'requiredCoveragePre',
        type: 'uint256',
      },
      {
        internalType: 'bool',
        name: 'eligible',
        type: 'bool',
      },
      {
        internalType: 'uint256',
        name: 'withdrawAvailableAt',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'positionVersion',
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
        name: 'keywordId',
        type: 'bytes32',
      },
    ],
    name: 'topStakeOf',
    outputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'staker',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'amount',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'bidUsd',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'positionVersion',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'requiredCoveragePre',
            type: 'uint256',
          },
        ],
        internalType: 'struct PREKeywordMarketV1.StakingDetails',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalStaked',
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
    name: 'unpause',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'keywordId',
        type: 'bytes32',
      },
    ],
    name: 'unstake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'recipient',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amountPre',
        type: 'uint256',
      },
    ],
    name: 'withdrawAccrued',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
