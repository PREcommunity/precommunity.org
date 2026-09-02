import { expect, test, type Locator, type Page } from '@playwright/test';
import { decodeFunctionData, encodeFunctionData } from 'viem';
import { BASE_SEPOLIA_DEPLOYMENT, PRECOMMUNITY_ESCROW_ABI } from '@precommunity/shared';

const connectedAddress = `0x${'55'.repeat(20)}` as const;

function forumTopicForBrowser() {
  return {
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
    author: {
      address: connectedAddress,
      displayName: 'Local member',
      avatarUrl: null,
      websiteUrl: null,
    },
    moderationNote: null,
    replies: [],
    nextReplyCursor: null,
  };
}

async function installConnectedWallet(page: Page) {
  await page.addInitScript(
    ({ account }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const sentTransactions: Array<Record<string, unknown>> = [];
      let transactionIndex = 0;
      const transactionHashes = [
        `0x${'88'.repeat(32)}`,
        `0x${'99'.repeat(32)}`,
        `0x${'aa'.repeat(32)}`,
      ];
      const provider = {
        isMetaMask: true,
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
          if (method === 'eth_chainId') return '0x14a34';
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain')
            return null;
          if (method === 'wallet_getCapabilities') return {};
          if (method === 'eth_sendTransaction') {
            sentTransactions.push((params[0] ?? {}) as Record<string, unknown>);
            const hash =
              transactionHashes[transactionIndex] ??
              transactionHashes[transactionHashes.length - 1];
            transactionIndex += 1;
            return hash;
          }
          if (method === 'personal_sign') return `0x${'11'.repeat(65)}`;
          return '0x0';
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const group = listeners.get(event) ?? new Set();
          group.add(listener);
          listeners.set(event, group);
        },
        removeListener: (event: string, listener: (...args: unknown[]) => void) =>
          listeners.get(event)?.delete(listener),
      };
      Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
      Object.assign(window, { __sentTransactions: sentTransactions });
    },
    { account: connectedAddress },
  );
}

async function connectInjectedWallet(page: Page, trigger: Locator) {
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('rk-wallet-option-injected').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('public ledger keeps the selected period when opening a verified goal', async ({ page }) => {
  await page.goto('/?month=2099-08');
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByTestId('funding-page')
        .locator(':scope > section')
        .evaluateAll((sections) =>
          sections.map((section) => section.querySelector('h1, h2')?.textContent?.trim()),
        ),
    )
    .toEqual(['Goals', 'Activity', 'Funding summary']);
  await expect(page.getByText('Local chain infrastructure')).toBeVisible();
  const goalLink = page.getByRole('link', {
    name: 'View Local chain infrastructure',
  });
  await expect(goalLink.getByText('25 PRE / 100 PRE')).toBeVisible();
  await expect(goalLink).toHaveAttribute('href', /month=2099-08/);
  await Promise.all([
    page.waitForURL(
      (url) =>
        url.pathname.startsWith('/goals/local-chain-infrastructure-') &&
        url.searchParams.get('month') === '2099-08',
    ),
    goalLink.click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Local chain infrastructure' })).toBeVisible();
  await expect(page.getByText('Creation proof')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to verified goals' })).toHaveAttribute(
    'href',
    /month=2099-08/,
  );
  await expect(page.getByRole('button', { name: 'Connect wallet to contribute' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Contributions' })).toBeVisible();
  await expect(page.getByText('Current builder profile')).toBeVisible();
  await expect(page.getByText('Anonymous user')).toBeVisible();
  await expect(page.getByRole('link', { name: /0x5555…5555/ })).toHaveAttribute(
    'href',
    `https://sepolia.basescan.org/address/${connectedAddress}`,
  );
});

test('home keeps only the PRE community identity and functional previews', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PRE community', exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'The PRE Community is a public, community-funded effort to rebuild decentralized search - in the open, on a ledger anyone can audit.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Community', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Welcome to the community forum/ })).toHaveAttribute(
    'href',
    '/community/forum/welcome-to-the-forum-a1b2c3',
  );
  await expect(page.getByRole('heading', { name: 'Funding', exact: true })).toBeVisible();
  await expect(page.getByTestId('home-section')).toHaveCount(2);
  await expect(page.getByText('Discuss first. Propose when it is ready.')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'One path from conversation to public proof.' }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Explore the community' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'PRE community home' }).getByText('community', { exact: true }),
  ).toBeVisible();
});

test('about renders the project document and keeps the final community action', async ({
  page,
}) => {
  await page.goto('/about');

  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
  await expect(
    page.getByText(/The PRE Community is a public, community-funded effort/),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '01 / What happened' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '10 / What we are not promising' })).toBeVisible();
  await expect(page.getByText('Names will follow work. Not the other way around.')).toBeVisible();
  await expect(page.getByText('Conversation stays open. Funding stays verifiable.')).toHaveCount(0);
  await expect(page.getByText(/Start here:/)).toHaveCount(0);
  await expect(page.getByText('Join the process')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Community' })).toHaveAttribute(
    'href',
    '/community',
  );
});

test('forum topic register distinguishes a service failure from an empty list', async ({
  page,
}) => {
  await page.route('**/v1/community/forum/topics/mine', (route) => route.fulfill({ status: 503 }));
  await page.goto('/community/forum/mine');

  await expect(page.getByRole('heading', { name: 'Topics unavailable' })).toBeVisible();
  await expect(page.getByText('Your topics could not be loaded.')).toBeVisible();
  await expect(page.getByText('No topics yet.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('community hub keeps forum discussion separate from formal proposals', async ({ page }) => {
  await page.goto('/community');
  await expect(page.getByRole('heading', { name: 'Forum', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Proposals', exact: true })).toBeVisible();
  await expect(page.getByText('Discuss openly. Decide deliberately.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /View forum/ })).toHaveAttribute(
    'href',
    '/community/forum',
  );
  await expect(page.getByRole('link', { name: /View proposals/ })).toHaveAttribute(
    'href',
    '/community/proposals',
  );
  await expect(page.getByText('Welcome to the community forum')).toBeVisible();
  await expect(page.getByText('Expand public search nodes')).toBeVisible();
});

test('footer reaches the bottom edge on a short page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/community');

  const footer = page.getByRole('contentinfo');
  await expect(footer).toBeVisible();
  const box = await footer.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.y + box!.height - 900)).toBeLessThanOrEqual(1);
});

test('forum submits a valid topic and navigates to the published discussion', async ({ page }) => {
  await page.route('**/v1/community/forum/topics', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ...forumTopicForBrowser(),
        slug: 'new-community-topic-112233',
        title: 'A new community topic',
      }),
    });
  });
  await page.goto('/community/forum');
  await page.getByRole('button', { name: 'Start a topic' }).click();
  await page.getByLabel('Title').fill('A new community topic');
  await page
    .getByLabel('Opening post')
    .fill('This opening post gives the community enough useful context.');
  await page.getByRole('button', { name: 'Publish topic' }).click();
  await page.waitForURL('**/community/forum/new-community-topic-112233');
});

test('forum saves, previews and publishes an account draft', async ({ page }) => {
  let published = false;
  let publishRequests = 0;
  const draft = {
    ...forumTopicForBrowser(),
    id: '00000000-0000-4000-8000-000000000017',
    slug: 'draft-a1b2c3',
    title: 'Drafted topic',
    body: '**Draft preview**',
    status: 'DRAFT',
  };
  await page.route('**/v1/community/forum/topics/drafts', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(draft),
    });
  });
  await page.route('**/v1/community/forum/topics/mine', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([published ? { ...draft, status: 'PUBLISHED' } : draft]),
    });
  });
  await page.route(`**/v1/community/forum/topics/${draft.id}/publish`, async (route) => {
    publishRequests += 1;
    published = true;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ...draft, status: 'PUBLISHED' }),
    });
  });

  await page.goto('/community/forum');
  await page.getByRole('button', { name: 'Start a topic' }).click();
  await page.getByLabel('Title').fill(draft.title);
  await page.getByLabel('Opening post').fill(draft.body);
  await page.getByRole('button', { name: 'Save draft' }).click();

  await expect(page).toHaveURL(/\/community\/forum\/mine\?submitted=draft/);
  await expect(page.getByText('Draft saved to your account.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByText('Draft preview')).toBeVisible();
  await page.getByRole('button', { name: 'Publish topic' }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => publishRequests).toBe(1);
  await expect(page.getByText('Draft published.')).toBeVisible();
});

test('forum renders Markdown without loading remote images', async ({ page }) => {
  await page.goto('/community/forum/markdown-topic-a1b2c3');

  await expect(page.getByRole('heading', { name: 'Rendered heading' })).toBeVisible();
  await expect(page.getByText('Rendered response')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Architecture diagram' })).toHaveAttribute(
    'href',
    'https://example.com/architecture.png',
  );
  await expect(page.locator('img[src="https://example.com/architecture.png"]')).toHaveCount(0);
});

test('forum replaces topics and pagination state when the category changes', async ({ page }) => {
  await page.goto('/community/forum');
  await expect(page.getByText('Welcome to the community forum')).toBeVisible();
  await page.getByRole('button', { name: 'Start a topic' }).click();

  await page.getByRole('link', { name: 'Technical' }).click();

  await expect(page).toHaveURL(/category=TECHNICAL/);
  await expect(page.getByText('Technical indexing question')).toBeVisible();
  await expect(page.getByText('Welcome to the community forum')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start a topic' })).toBeVisible();
});

test('forum keeps archived categories as filters but not new-topic choices', async ({ page }) => {
  await page.goto('/community/forum');

  await expect(page.getByRole('link', { name: 'Help', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start a topic' }).click();
  await expect(page.locator('select[name="category"] option[value="HELP"]')).toHaveCount(0);
});

test('forum explains that a signed-in wallet is required when topic creation is unauthorized', async ({
  page,
}) => {
  await page.goto('/community/forum');
  await page.getByRole('button', { name: 'Start a topic' }).click();
  await page.getByLabel('Title').fill('A topic without a session');
  await page
    .getByLabel('Opening post')
    .fill('This request should be rejected because no signed session exists.');
  await page.getByRole('button', { name: 'Publish topic' }).click();
  await expect(page.getByText('Connect and sign in with your wallet first.')).toBeVisible();
});

test('forum recovers when topic creation cannot reach the API', async ({ page }) => {
  await page.route('**/v1/community/forum/topics', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.abort('failed');
  });
  await page.goto('/community/forum');
  await page.getByRole('button', { name: 'Start a topic' }).click();
  await page.getByLabel('Title').fill('A topic during an API outage');
  await page
    .getByLabel('Opening post')
    .fill('The interface should recover after this network request fails.');
  await page.getByRole('button', { name: 'Publish topic' }).click();

  await expect(page.getByText('The forum service could not be reached. Try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish topic' })).toBeEnabled();
});

test('forum loads earlier responses without returning the full discussion initially', async ({
  page,
}) => {
  await page.goto('/community/forum/paginated-topic-a1b2c3');
  await expect(page.getByText('The newest visible response.')).toBeVisible();
  await expect(page.getByText('The earlier paginated response.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Load earlier responses' }).click();

  await expect(page.getByText('The earlier paginated response.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load earlier responses' })).toHaveCount(0);
});

test('mobile navigation exposes the new primary sections', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Community' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Funding' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'About' })).toBeVisible();
});

test('authenticated session distinguishes a disconnected wallet and exposes recovery', async ({
  page,
}) => {
  const sessionAddress = `0x${'aa'.repeat(20)}`;

  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ address: sessionAddress }),
    }),
  );
  await page.route('**/v1/auth/logout', (route) => route.fulfill({ status: 204 }));

  await page.goto('/');
  const accountButton = page.getByRole('button', {
    name: 'Signed-in session 0xaaaa…aaaa. Wallet disconnected. Open account menu',
  });
  await expect(accountButton).toBeVisible();
  expect((await accountButton.boundingBox())?.width).toBeLessThanOrEqual(36);

  await accountButton.click();
  await expect(page.getByText('0xaaaa…aaaa')).toBeVisible();
  await expect(page.getByText('Wallet disconnected')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reconnect wallet' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
});

test('a stalled wallet connector cannot leave restoration pending forever', async ({ page }) => {
  const sessionAddress = `0x${'aa'.repeat(20)}`;

  await page.addInitScript(() => {
    localStorage.setItem('wagmi.recentConnectorId', JSON.stringify('injected'));
    localStorage.setItem('wagmi.injected.connected', JSON.stringify(true));
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: ({ method }: { method: string }) =>
          method === 'eth_accounts'
            ? new Promise(() => undefined)
            : Promise.resolve(method === 'eth_chainId' ? '0x14a34' : null),
        on: () => undefined,
        removeListener: () => undefined,
      },
    });
  });
  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ address: sessionAddress }),
    }),
  );

  await page.goto('/');
  await expect(
    page.getByRole('button', {
      name: /Restoring wallet connection/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Wallet disconnected/,
    }),
  ).toBeVisible({ timeout: 7_000 });
});

test('contribution panel opens the wallet chooser instead of showing a stale connection error', async ({
  page,
}) => {
  const sessionAddress = `0x${'aa'.repeat(20)}`;

  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ address: sessionAddress }),
    }),
  );

  await page.goto('/goals/local-chain-infrastructure-11111111');
  await page.getByRole('button', { name: 'Connect wallet to contribute' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Connect a Wallet')).toBeVisible();
  await expect(page.getByText('Connect a wallet first.')).toHaveCount(0);
});

test('contribution panel reads the on-chain default and keeps a final per-payment choice', async ({
  page,
}) => {
  await installConnectedWallet(page);
  await page.goto('/goals/local-chain-infrastructure-11111111');
  await connectInjectedWallet(
    page,
    page.getByRole('button', { name: 'Connect wallet to contribute' }),
  );
  await expect(page.getByRole('button', { name: 'Show profile' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Anonymous' }).click();
  await expect(page.getByRole('button', { name: 'Anonymous' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Show profile' }).click();
  await expect(page.getByRole('button', { name: 'Show profile' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('contribution requests approval after a sufficient PRE balance check', async ({ page }) => {
  await installConnectedWallet(page);
  await page.goto('/goals/local-chain-infrastructure-11111111');
  await connectInjectedWallet(
    page,
    page.getByRole('button', { name: 'Connect wallet to contribute' }),
  );

  await page.locator('input[inputmode="decimal"]').fill('1');
  await page.getByRole('button', { name: 'Contribute PRE' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __sentTransactions?: unknown[] }).__sentTransactions
            ?.length ?? 0,
      ),
    )
    .toBe(1);
});

test('contribution stops before approval when selected USDC balance is insufficient', async ({
  page,
}) => {
  await installConnectedWallet(page);
  await page.goto('/goals/local-chain-infrastructure-11111111');
  await connectInjectedWallet(
    page,
    page.getByRole('button', { name: 'Connect wallet to contribute' }),
  );
  await page.getByRole('button', { name: 'USDC' }).click();
  await page.locator('input[inputmode="decimal"]').fill('1');
  await page.getByRole('button', { name: 'Contribute USDC' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Insufficient USDC balance for this contribution.',
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __sentTransactions?: unknown[] }).__sentTransactions?.length ??
        0,
    ),
  ).toBe(0);
});

test('wallet connection opens the RainbowKit wallet chooser', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Connect a Wallet')).toBeVisible();
  await expect(page.getByTestId('rk-wallet-option-base')).toBeVisible();
});

test('admin surface does not expose local chain fixtures as admin records', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\?tab=operations$/);
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link'),
  ).toHaveText(['Operations']);
  await expect(page.getByText('Connect an authorized wallet')).toBeVisible();
  await expect(page.getByText('Local chain infrastructure')).toHaveCount(0);
  await expect(page.getByText('Base Sepolia manifest active.')).toHaveCount(0);
  await expect(page.getByText('Awaiting confirmed owner projection')).toHaveCount(0);
});

test('goal manager panel exposes policy sources and prepares direct owner synchronization', async ({
  page,
}) => {
  await installConnectedWallet(page);
  const safeAddress = `0x${'99'.repeat(20)}` as const;
  const formerOwner = `0x${'33'.repeat(20)}` as const;
  const newManualManager = `0x${'44'.repeat(20)}` as const;
  const existingManualManager = `0x${'66'.repeat(20)}` as const;
  const updates: Array<{ address: string; enabled: boolean }> = [];
  let refreshes = 0;
  const managerWorkspace = {
    safeConfigured: true,
    safeAddress,
    safeIsEscrowOwner: false,
    actorIsSafeOwner: true,
    maxOpenGoalsPerManager: 3,
    inSync: false,
    entries: [
      {
        address: connectedAddress,
        safeOwner: true,
        safeManaged: true,
        manualPinned: false,
        legacy: false,
        actual: false,
        desired: true,
        onChainEnabled: false,
        openGoalCount: 0,
        status: 'NEEDS_ADD',
      },
      {
        address: formerOwner,
        safeOwner: false,
        safeManaged: true,
        manualPinned: false,
        legacy: false,
        actual: true,
        desired: false,
        onChainEnabled: true,
        openGoalCount: 2,
        status: 'NEEDS_REMOVE',
      },
      {
        address: existingManualManager,
        safeOwner: false,
        safeManaged: false,
        manualPinned: true,
        legacy: false,
        actual: true,
        desired: true,
        onChainEnabled: true,
        openGoalCount: 1,
        status: 'SYNCED',
      },
    ],
    activeProposal: null,
    latestProposal: {
      safeTxHash: `0x${'12'.repeat(32)}`,
      safeNonce: '6',
      confirmations: 1,
      threshold: 2,
      status: 'STALE',
      executionTxHash: null,
      failureReason: 'Safe owners changed. Do not execute this proposal.',
      changes: [{ address: formerOwner, enabled: false }],
      queueUrl: 'https://app.safe.global/transactions/queue?safe=basesep:test',
    },
  };
  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: 'admin-id',
        address: connectedAddress,
        roles: ['SUPER_ADMIN'],
        chainAuthorities: ['OWNER'],
        chainOwnerAddress: connectedAddress,
        safeOwner: false,
        safeAddress,
      }),
    }),
  );
  await page.route('**/v1/admin/safe/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        serviceConfigured: true,
        network: 'base-sepolia',
        networkName: 'Base Sepolia',
        chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
        escrowAddress: BASE_SEPOLIA_DEPLOYMENT.escrowAddress,
        address: safeAddress,
        owners: [connectedAddress],
        threshold: 1,
        escrowOwner: connectedAddress,
        isEscrowOwner: false,
        isPendingEscrowOwner: false,
        safeOwner: false,
      }),
    }),
  );
  await page.route('**/v1/admin/workspace', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/v1/admin/safe-payout-proposals', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/v1/admin/goal-managers/*', async (route) => {
    updates.push({
      address: route.request().url().split('/').at(-1)!,
      enabled: (route.request().postDataJSON() as { enabled: boolean }).enabled,
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'NONE', changes: [] }),
    });
  });
  await page.route('**/v1/admin/goal-managers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(managerWorkspace),
    }),
  );
  await page.route('**/v1/admin/goal-managers/refresh', async (route) => {
    refreshes += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'SYNCED', checked: 0, updated: 0 }),
    });
  });
  await page.route('**/v1/admin/goal-managers/safe-sync/prepare', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'DIRECT',
        changes: [{ address: connectedAddress, enabled: true }],
        transactions: [
          {
            chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
            to: BASE_SEPOLIA_DEPLOYMENT.escrowAddress,
            value: '0',
            data: encodeFunctionData({
              abi: PRECOMMUNITY_ESCROW_ABI,
              functionName: 'setGoalManager',
              args: [connectedAddress, true],
            }),
            operation: 0,
          },
        ],
      }),
    }),
  );
  await page.route('**/v1/community/admin/proposals', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ config: { proposalModerationEnabled: false }, proposals: [] }),
    }),
  );
  await page.route('**/v1/community/admin/forum', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        config: {
          topicModerationEnabled: false,
          minimumPre: { amount: '1', amountRaw: '1000000000000000000', asset: 'PRE' },
          categories: [],
        },
        topics: [],
      }),
    }),
  );

  await page.goto('/admin');
  const accountButton = page.getByRole('button', { name: /Signed-in session/ });
  await accountButton.click();
  await connectInjectedWallet(page, page.getByRole('menuitem', { name: 'Reconnect wallet' }));

  const adminSections = page.getByRole('navigation', { name: 'Admin sections' });
  await expect(adminSections.getByRole('link')).toHaveText([
    'Operations',
    'Forum',
    'Goals',
    'Keyword Marketplace',
  ]);
  await expect(page).toHaveURL(/\/admin\?tab=operations$/);
  await expect(page.getByRole('heading', { name: 'Goal managers' })).toBeVisible();
  await adminSections.getByRole('link', { name: 'Goals', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?tab=goals$/);
  await expect(page.getByRole('heading', { name: 'Goal managers' })).toHaveCount(0);
  await expect(page.getByText('0 goal drafts')).toBeVisible();
  await adminSections.getByRole('link', { name: 'Keyword Marketplace' }).click();
  await expect(page).toHaveURL(/\/admin\?tab=keyword-marketplace$/);
  await expect(page.getByRole('heading', { name: 'Keyword Marketplace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open ad moderation' })).toHaveAttribute(
    'href',
    '/keyword-market/admin',
  );
  await adminSections.getByRole('link', { name: 'Operations' }).click();
  await expect(page).toHaveURL(/\/admin\?tab=operations$/);
  await expect(page.getByRole('heading', { name: 'Goal managers' })).toBeVisible();
  await expect(page.getByText(connectedAddress)).toBeVisible();
  await expect(page.getByText(formerOwner)).toBeVisible();
  await expect(page.getByText('Safe owners changed — do not execute this proposal')).toBeVisible();

  await page.getByRole('button', { name: 'Refresh Safe data' }).click();
  await expect.poll(() => refreshes).toBe(1);
  await expect(page.getByText('Safe data refreshed.')).toBeVisible();

  await page.getByRole('button', { name: 'Keep after Safe removal' }).click();
  await expect.poll(() => updates).toContainEqual({ address: connectedAddress, enabled: true });

  const manualManagerRow = page
    .getByText(existingManualManager)
    .locator('xpath=ancestor::div[contains(@class,"group")][1]');
  await manualManagerRow.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText(/still has 1 open goal/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove manager' }).click();
  await expect
    .poll(() => updates)
    .toContainEqual({
      address: existingManualManager,
      enabled: false,
    });

  await page.getByLabel('Manually pin an address').fill(newManualManager);
  await page.getByRole('button', { name: 'Add manager' }).click();
  await expect.poll(() => updates).toContainEqual({ address: newManualManager, enabled: true });

  await page.getByRole('button', { name: 'Sync Safe owners' }).click();
  await expect(page.getByText(/former Safe owner with 2 open goals/)).toBeVisible();
  await page.getByRole('button', { name: 'Prepare sync' }).click();
  await expect(page.getByText(/Waiting for indexer confirmation/)).toBeVisible({ timeout: 20_000 });
  const transactions = await page.evaluate(
    () =>
      (window as unknown as { __sentTransactions: Array<{ data: `0x${string}` }> })
        .__sentTransactions,
  );
  expect(
    decodeFunctionData({ abi: PRECOMMUNITY_ESCROW_ABI, data: transactions.at(-1)!.data }),
  ).toMatchObject({ functionName: 'setGoalManager', args: [connectedAddress, true] });
});

test('forum moderator can open a pending discussion from its highlighted row', async ({ page }) => {
  await installConnectedWallet(page);
  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        address: connectedAddress,
        roles: ['CONTENT_ADMIN'],
        chainAuthorities: [],
        chainOwnerAddress: null,
      }),
    }),
  );
  await page.route('**/v1/admin/workspace', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/v1/community/admin/proposals', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ config: { proposalModerationEnabled: true }, proposals: [] }),
    }),
  );
  let adminCategories = [
    { value: 'GENERAL', label: 'General', archived: false },
    { value: 'TECHNICAL', label: 'Technical', archived: false },
  ];
  await page.route('**/v1/community/admin/forum', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        config: {
          topicModerationEnabled: true,
          minimumPre: { amount: '1', amountRaw: '1000000000000000000', asset: 'PRE' },
          categories: adminCategories,
        },
        topics: [
          {
            ...forumTopicForBrowser(),
            status: 'PENDING_REVIEW',
            title: 'Pending technical discussion',
          },
        ],
      }),
    }),
  );
  await page.route('**/v1/community/admin/forum/categories', async (route) => {
    const body = await route.request().postDataJSON();
    const created = {
      value: 'PRODUCT_UPDATES',
      label: String(body.label).trim(),
      archived: false,
    };
    adminCategories = [...adminCategories, created];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  });
  await page.route('**/v1/community/admin/forum/categories/*', async (route) => {
    const value = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
    const body = await route.request().postDataJSON();
    adminCategories = adminCategories.map((category) =>
      category.value === value
        ? {
            ...category,
            ...(body.label === undefined ? {} : { label: String(body.label).trim() }),
            ...(body.archived === undefined ? {} : { archived: Boolean(body.archived) }),
          }
        : category,
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(adminCategories.find((category) => category.value === value)),
    });
  });
  let savedMinimum = '';
  await page.route('**/v1/community/admin/forum/settings/minimum-pre', async (route) => {
    savedMinimum = String((await route.request().postDataJSON()).amount);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin');
  const accountButton = page.getByRole('button', { name: /Signed-in session/ });
  await accountButton.click();
  await connectInjectedWallet(page, page.getByRole('menuitem', { name: 'Reconnect wallet' }));
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('link', { name: 'Forum' })
    .click();
  await expect(page).toHaveURL(/\/admin\?tab=forum$/);
  await expect(page.getByRole('heading', { name: 'Discussion moderation' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Proposal review on' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Pending technical discussion/ })).toHaveAttribute(
    'href',
    '/community/forum/welcome-to-the-forum-a1b2c3',
  );
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByLabel('Category name').fill('Product Updates');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByText('Product Updates', { exact: true })).toBeVisible();

  let categoryRow = page
    .getByText('Product Updates', { exact: true })
    .locator('xpath=ancestor::article[1]');
  await categoryRow.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Category name').fill('Product News');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  categoryRow = page
    .getByText('Product News', { exact: true })
    .locator('xpath=ancestor::article[1]');
  await categoryRow.getByRole('button', { name: 'Archive' }).click();
  await expect(categoryRow.getByText('Archived', { exact: true })).toBeVisible();
  await categoryRow.getByRole('button', { name: 'Restore' }).click();
  await expect(categoryRow.getByText('Active', { exact: true })).toBeVisible();

  await page.getByLabel('Minimum PRE to write').fill('12.5');
  await page.getByRole('button', { name: 'Save minimum' }).click();
  await expect.poll(() => savedMinimum).toBe('12.5');
});

test('a connected wallet edits its profile without SIWE and awaits confirmation', async ({
  page,
}) => {
  await installConnectedWallet(page);
  let privateProfileRequests = 0;
  await page.route('**/v1/profile**', (route) => {
    privateProfileRequests += 1;
    return route.abort();
  });

  await page.goto('/profile');
  await connectInjectedWallet(
    page,
    page.getByRole('main').getByRole('button', { name: 'Connect wallet' }),
  );
  await expect(page.getByLabel('Display name')).toHaveValue('Local member');
  await expect(page.getByText('Current on-chain revision: 4')).toBeVisible();
  await page.getByLabel('Display name').fill('Updated member');
  await page
    .getByLabel('Avatar IPFS URI')
    .fill('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3g5lxy4t5c7hr4zy2m4ot6owe/avatar.webp');
  await page.getByRole('button', { name: 'Save profile on-chain' }).click();
  await expect(page.getByRole('button', { name: 'Awaiting confirmation…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profile confirmed' })).toBeVisible({
    timeout: 20_000,
  });
  expect(privateProfileRequests).toBe(0);

  const transactions = await page.evaluate(
    () =>
      (window as unknown as { __sentTransactions: Array<{ data: `0x${string}` }> })
        .__sentTransactions,
  );
  const decoded = decodeFunctionData({ abi: PRECOMMUNITY_ESCROW_ABI, data: transactions[0]!.data });
  expect(decoded.functionName).toBe('setProfile');
  expect(decoded.args?.[0]).toBe('Updated member');
  expect(decoded.args?.[3]).toMatch(/^ipfs:\/\//);
});

test('profile editing needs a wallet connection, not a signed API session', async ({ page }) => {
  await page.route('**/v1/auth/me', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Your community profile.' })).toBeVisible();
  await expect(page.getByText('Connect your wallet to edit your profile')).toBeVisible();
  await expect(page.getByText('Sign in to edit your profile')).toHaveCount(0);
  await page.getByRole('main').getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Connect a Wallet')).toBeVisible();
});

test('goal contribution list remains readable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/goals/local-chain-infrastructure-11111111');
  await expect(page.getByRole('heading', { name: 'Contributions' })).toBeVisible();
  await expect(page.getByText('Current builder profile')).toBeVisible();
  await expect(page.getByText('15 PRE')).toBeVisible();
  await expect(page.getByText('Anonymous user')).toBeVisible();
});
