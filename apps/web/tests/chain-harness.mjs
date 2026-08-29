import { createServer } from 'node:http';
import { BASE_SEPOLIA_DEPLOYMENT } from '@precommunity/shared';
import { encodeAbiParameters } from 'viem';

const apiPort = 4100;
const month = '2099-08';
const goalId = `0x${'11'.repeat(32)}`;
const creationHash = `0x${'22'.repeat(32)}`;
const contributionHash = `0x${'33'.repeat(32)}`;
const escrowAddress = `0x${'44'.repeat(20)}`;
const recipient = `0x${'55'.repeat(20)}`;
const slug = `local-chain-infrastructure-${goalId.slice(2, 10)}`;
const preProgress = {
  asset: 'PRE',
  target: '100',
  funded: '25',
  released: '0',
  surplus: '0',
  percent: 25,
};
const usdcProgress = {
  asset: 'USDC',
  target: '250',
  funded: '0',
  released: '0',
  surplus: '0',
  percent: 0,
};
const goal = {
  id: goalId,
  slug,
  title: 'Local chain infrastructure',
  description: 'A deterministic browser fixture representing a confirmed API projection.',
  goalId,
  chainGoalId: goalId,
  recipientAddress: recipient,
  deadline: '2099-08-31T23:59:59.000Z',
  creationTxHash: creationHash,
  creationBlock: '101',
  metadataStatus: 'NOT_SET',
  documents: [],
  status: 'OPEN',
  progress: [preProgress, usdcProgress],
};
const dashboard = {
  source: 'CHAIN',
  project: { name: 'precommunity', slug: 'precommunity', description: 'Deterministic E2E ledger.' },
  month,
  generatedAt: '2099-08-15T12:00:00.000Z',
  chainId: 84532,
  network: 'Base Sepolia',
  escrowAddress,
  indexedThroughBlock: '120',
  confirmations: 12,
  lastIndexedAt: '2099-08-15T12:00:00.000Z',
  syncStatus: 'SYNCED',
  totals: [preProgress, usdcProgress],
  goals: [goal],
  activity: [
    {
      id: `${contributionHash}:0`,
      kind: 'CONTRIBUTION',
      label: 'Anonymous user',
      amount: '25',
      asset: 'PRE',
      occurredAt: '2099-08-15T11:00:00.000Z',
      transactionUrl: `https://sepolia.basescan.org/tx/${contributionHash}`,
    },
  ],
};
const contributions = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      label: 'Current builder profile',
      amount: '15',
      asset: 'PRE',
      visibility: 'PUBLIC',
      occurredAt: '2099-08-15T11:00:00.000Z',
      blockNumber: '119',
      transactionUrl: `https://sepolia.basescan.org/tx/${contributionHash}`,
      sponsorUrl: `/community/profiles/${recipient}`,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      label: 'Anonymous user',
      amount: '10',
      asset: 'PRE',
      visibility: 'ANONYMOUS',
      occurredAt: '2099-08-15T10:00:00.000Z',
      blockNumber: '118',
      transactionUrl: `https://sepolia.basescan.org/tx/${contributionHash}`,
    },
  ],
  nextCursor: null,
};
const communityAuthor = {
  address: recipient,
  displayName: 'Local member',
  avatarUrl: null,
  websiteUrl: null,
};
const forumTopic = {
  id: '00000000-0000-4000-8000-000000000010',
  slug: 'welcome-to-the-forum-a1b2c3',
  title: 'Welcome to the community forum',
  excerpt: 'Share useful context before an idea becomes a formal proposal.',
  body: 'Share useful context before an idea becomes a formal proposal.',
  state: 'ACTIVE',
  category: 'GENERAL',
  status: 'PUBLISHED',
  replyCount: 0,
  lastActivityAt: '2099-08-15T12:00:00.000Z',
  createdAt: '2099-08-15T12:00:00.000Z',
  updatedAt: '2099-08-15T12:00:00.000Z',
  author: communityAuthor,
  moderationNote: null,
  replies: [],
  nextReplyCursor: null,
};
const technicalForumTopic = {
  ...forumTopic,
  id: '00000000-0000-4000-8000-000000000014',
  slug: 'technical-indexing-question-d4e5f6',
  title: 'Technical indexing question',
  excerpt: 'A technical discussion returned only by the Technical category filter.',
  body: 'A technical discussion returned only by the Technical category filter.',
  category: 'TECHNICAL',
};
const paginatedForumTopic = {
  ...forumTopic,
  id: '00000000-0000-4000-8000-000000000011',
  slug: 'paginated-topic-a1b2c3',
  title: 'A long-running community discussion',
  replyCount: 2,
  replies: [
    {
      id: '00000000-0000-4000-8000-000000000012',
      body: 'The newest visible response.',
      state: 'ACTIVE',
      editedAt: null,
      createdAt: '2099-08-15T12:00:00.000Z',
      author: communityAuthor,
    },
  ],
  nextReplyCursor: 'fixture-older-page',
};
const olderForumReplies = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000013',
      body: 'The earlier paginated response.',
      state: 'ACTIVE',
      editedAt: null,
      createdAt: '2099-08-14T12:00:00.000Z',
      author: communityAuthor,
    },
  ],
  nextCursor: null,
};
const forumPage = {
  items: [{ ...forumTopic, body: undefined, moderationNote: undefined, replies: undefined }],
  nextCursor: null,
};
const technicalForumPage = {
  items: [
    { ...technicalForumTopic, body: undefined, moderationNote: undefined, replies: undefined },
  ],
  nextCursor: null,
};
const forumConfig = {
  topicModerationEnabled: false,
  minimumPre: { amount: '1', amountRaw: '1000000000000000000', asset: 'PRE' },
  categories: [
    { value: 'GENERAL', label: 'General' },
    { value: 'IDEAS_FEEDBACK', label: 'Ideas & Feedback' },
    { value: 'TECHNICAL', label: 'Technical' },
    { value: 'HELP', label: 'Help' },
  ],
};
const proposal = {
  id: '00000000-0000-4000-8000-000000000020',
  slug: 'public-nodes-d4e5f6',
  title: 'Expand public search nodes',
  description: 'Support resilient public infrastructure for the ecosystem.',
  category: 'Infrastructure',
  status: 'VOTING',
  snapshotBlock: '100',
  votingStartsAt: '2099-08-10T12:00:00.000Z',
  votingEndsAt: '2099-08-20T12:00:00.000Z',
  closedAt: null,
  moderationNote: null,
  createdAt: '2099-08-10T12:00:00.000Z',
  updatedAt: '2099-08-10T12:00:00.000Z',
  author: communityAuthor,
  results: { forRaw: '5000000000000000000', againstRaw: '0', abstainRaw: '0', voterCount: 1 },
  convertedExpense: null,
  comments: [],
};

const profileResult = encodeAbiParameters(
  [
    {
      type: 'tuple',
      components: [
        { name: 'active', type: 'bool' },
        { name: 'revision', type: 'uint64' },
        { name: 'displayName', type: 'string' },
        { name: 'websiteUrl', type: 'string' },
        { name: 'bio', type: 'string' },
        { name: 'avatarURI', type: 'string' },
        { name: 'defaultPublic', type: 'bool' },
      ],
    },
  ],
  [
    {
      active: true,
      revision: 4n,
      displayName: 'Local member',
      websiteUrl: 'https://example.org',
      bio: 'Local on-chain profile.',
      avatarURI: '',
      defaultPublic: true,
    },
  ],
);
const multicallProfileResult = encodeAbiParameters(
  [
    {
      type: 'tuple[]',
      components: [
        { name: 'success', type: 'bool' },
        { name: 'returnData', type: 'bytes' },
      ],
    },
  ],
  [[{ success: true, returnData: profileResult }]],
);

let lastReceiptHash = '';
let blockPolls = 0;

function rpcResult(method, params = []) {
  if (method === 'eth_chainId') return '0x14a34';
  if (method === 'eth_call') {
    const call = params[0] ?? {};
    if (String(call.data ?? '').startsWith('0x70a08231')) {
      return String(call.to ?? '').toLowerCase() ===
        BASE_SEPOLIA_DEPLOYMENT.preAddress.toLowerCase()
        ? `0x${(1_000n * 10n ** 18n).toString(16).padStart(64, '0')}`
        : `0x${'0'.repeat(64)}`;
    }
    return String(call.to ?? '').toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11'
      ? multicallProfileResult
      : profileResult;
  }
  if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
  if (method === 'eth_estimateGas') return '0x249f0';
  if (method === 'eth_getCode') return '0x01';
  if (method === 'eth_getLogs') return [];
  if (method === 'eth_getTransactionReceipt') {
    const hash = String(params[0] ?? contributionHash);
    if (hash !== lastReceiptHash) {
      lastReceiptHash = hash;
      blockPolls = 0;
    }
    return {
      blockHash: `0x${'77'.repeat(32)}`,
      blockNumber: '0x64',
      contractAddress: null,
      cumulativeGasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00',
      from: recipient,
      gasUsed: '0x5208',
      logs: [],
      logsBloom: `0x${'0'.repeat(512)}`,
      status: '0x1',
      to: escrowAddress,
      transactionHash: hash,
      transactionIndex: '0x0',
      type: '0x2',
    };
  }
  if (method === 'eth_blockNumber') {
    blockPolls += 1;
    return `0x${(100 + Math.min(blockPolls * 4, 11)).toString(16)}`;
  }
  if (method === 'eth_getBlockByNumber') {
    const number = params[0] === 'latest' ? 111 : Number(BigInt(String(params[0])));
    return {
      baseFeePerGas: '0x3b9aca00',
      difficulty: '0x0',
      extraData: '0x',
      gasLimit: '0x1c9c380',
      gasUsed: '0x5208',
      hash: `0x${'77'.repeat(32)}`,
      logsBloom: `0x${'0'.repeat(512)}`,
      miner: recipient,
      mixHash: `0x${'0'.repeat(64)}`,
      nonce: '0x0000000000000000',
      number: `0x${number.toString(16)}`,
      parentHash: `0x${'66'.repeat(32)}`,
      receiptsRoot: `0x${'55'.repeat(32)}`,
      sha3Uncles: `0x${'44'.repeat(32)}`,
      size: '0x1',
      stateRoot: `0x${'33'.repeat(32)}`,
      timestamp: '0xf4865700',
      totalDifficulty: '0x0',
      transactions: [],
      transactionsRoot: `0x${'22'.repeat(32)}`,
      uncles: [],
    };
  }
  return '0x0';
}

createServer((request, response) => {
  response.setHeader('access-control-allow-origin', request.headers.origin ?? '*');
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('vary', 'origin');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === '/rpc' && request.method === 'POST') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body);
      const execute = (call) => ({
        jsonrpc: '2.0',
        id: call.id,
        result: rpcResult(call.method, call.params),
      });
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(Array.isArray(payload) ? payload.map(execute) : execute(payload)),
      );
    });
    return;
  }
  if (request.url === '/health') {
    response.writeHead(200);
    response.end('ok');
    return;
  }
  if (request.url?.startsWith('/v1/public/dashboard')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(dashboard));
    return;
  }
  if (request.url === '/v1/public/features') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keywordMarketEnabled: true }));
    return;
  }
  if (request.url?.includes('/contributions')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(contributions));
    return;
  }
  if (request.url?.startsWith('/v1/public/goals/')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(goal));
    return;
  }
  if (request.url?.startsWith('/v1/public/reports')) {
    response.setHeader('content-type', 'text/csv');
    response.end('month,goal,asset,target,funded\n');
    return;
  }
  if (request.url === '/v1/community/forum/config') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(forumConfig));
    return;
  }
  if (request.url === '/v1/community/forum/topics/mine') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify([forumTopic]));
    return;
  }
  if (
    request.url?.startsWith('/v1/community/forum/topics?') ||
    request.url === '/v1/community/forum/topics'
  ) {
    if (request.method === 'POST') {
      response.setHeader('content-type', 'application/json');
      response.writeHead(401);
      response.end(JSON.stringify({ message: 'Connect a wallet to continue' }));
      return;
    }
    const page = request.url?.includes('category=TECHNICAL') ? technicalForumPage : forumPage;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(page));
    return;
  }
  if (request.url?.startsWith('/v1/community/forum/topics/paginated-topic-a1b2c3/replies?')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(olderForumReplies));
    return;
  }
  if (request.url === '/v1/community/forum/topics/paginated-topic-a1b2c3') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(paginatedForumTopic));
    return;
  }
  if (request.url?.startsWith('/v1/community/forum/topics/')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(forumTopic));
    return;
  }
  if (request.url?.startsWith('/v1/community/proposals/')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(proposal));
    return;
  }
  if (request.url?.startsWith('/v1/community/proposals')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify([proposal]));
    return;
  }
  if (request.url === '/v1/admin/safe/status') {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        configured: false,
        serviceConfigured: false,
        network: 'base-sepolia',
        networkName: 'Base Sepolia',
        chainId: 84532,
        escrowAddress: BASE_SEPOLIA_DEPLOYMENT.escrowAddress,
        safeOwner: false,
      }),
    );
    return;
  }
  if (request.url === '/v1/admin/goal-managers') {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        safeConfigured: false,
        safeAddress: null,
        safeIsEscrowOwner: false,
        actorIsSafeOwner: false,
        maxOpenGoalsPerManager: 3,
        inSync: true,
        entries: [],
        activeProposal: null,
        latestProposal: null,
      }),
    );
    return;
  }
  if (request.url === '/v1/auth/me') {
    response.setHeader('content-type', 'application/json');
    response.writeHead(401);
    response.end(JSON.stringify({ message: 'Connect a wallet to continue' }));
    return;
  }
  response.writeHead(503);
  response.end();
}).listen(apiPort, '127.0.0.1', () =>
  process.stdout.write(`Deterministic API fixture ready on ${apiPort}\n`),
);
