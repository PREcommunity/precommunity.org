import { expect, test, type Locator, type Page } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const siteBase = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const marketBase = `${siteBase}/keyword-market`;
const campaignId = '00000000-0000-4000-8000-000000000101';
const revisionId = '00000000-0000-4000-8000-000000000102';
const address = '0x0000000000000000000000000000000000000011';

const creative = {
  id: revisionId,
  version: 1,
  headline: 'Bitcoin in Poland',
  description: 'A deterministic creative fixture for the PRE Keyword Market browser flow.',
  destinationUrl: 'https://example.com/bitcoin',
  displayDomain: 'example.com',
  status: 'APPROVED',
  moderationNote: null,
  createdAt: '2026-08-24T12:00:00.000Z',
  lifetimeResolutions: '42',
  last30DaysResolutions: '9',
};

const campaign = {
  id: campaignId,
  keyword: 'bitcoin poland',
  paused: false,
  chainStatus: 'AWAITING_CONTRACT',
  position: null,
  leaderBidUsdRaw: null,
  bidNeededToLeadUsdRaw: null,
  activeRevision: creative,
  pendingRevision: null,
  revisions: [creative],
  lifetimeViews: '120',
  lifetimeClicks: '12',
  createdAt: '2026-08-24T12:00:00.000Z',
  updatedAt: '2026-08-24T12:00:00.000Z',
};

const publicPosition = {
  rank: 1,
  stakerAddress: '0x0000000000000000000000000000000000000022',
  stakeRaw: '2500000000000000000',
  bidUsdRaw: '100000',
  requiredCoveragePreRaw: '1000000000000000000',
  eligible: true,
  withdrawAvailableAt: '0',
  positionVersion: '1',
  amountSinceBlock: '88',
  amountSinceLogIndex: 1,
  positionBlock: '88',
  positionTxHash: `0x${'2'.repeat(64)}`,
  hasEligibleAd: true,
};

const marketStatus = {
  status: 'SYNCED',
  chainId: 8453,
  contractAddress: '0x0000000000000000000000000000000000000099',
  deploymentBlock: '1',
  transactionsEnabled: true,
  indexedThroughBlock: '120',
  minimumStakeRaw: '1000000000000000000',
  preTokenAddress: '0x0000000000000000000000000000000000000001',
};

async function routeSignedInSession(page: Page, roles = ['CONTENT_ADMIN']) {
  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ address, roles }),
    }),
  );
}

function contrastRatio(first: string, second: string) {
  const luminance = (color: string) => {
    const [red, green, blue] = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((channel) => {
        const value = Number(channel) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

async function expectVisibleControl(control: Locator, filled = false) {
  const colors = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      text: style.color,
      background: style.backgroundColor,
      border: style.borderTopColor,
      page: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(filled ? colors.background : colors.border, colors.page),
  ).toBeGreaterThanOrEqual(3);
}

for (const theme of ['light', 'dark']) {
  test(`campaign action buttons remain visible in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('precommunity-theme', value), theme);
    await routeSignedInSession(page);
    await page.route('**/v1/keyword-market/status', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(marketStatus) }),
    );
    await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            ...campaign,
            chainStatus: 'SYNCED',
            position: { ...publicPosition, stakerAddress: address, withdrawAvailableAt: '1' },
          },
        ]),
      }),
    );

    await page.goto(`${marketBase}/campaigns/${campaignId}/edit`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeVisible();
    await expectVisibleControl(save, true);
    if (testInfo.project.name === 'desktop') {
      await save.hover();
      await expectVisibleControl(save, true);
    }

    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    const edit = page.getByRole('link', { name: 'Edit', exact: true });
    await expect(edit).toBeVisible();
    await expectVisibleControl(edit, true);
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await expectVisibleControl(pause);
    const withdraw = page.getByRole('button', { name: 'Withdraw PRE', exact: true });
    await expect(withdraw).toBeEnabled();
    await expectVisibleControl(withdraw);
    if (testInfo.project.name === 'desktop') {
      await withdraw.hover();
      await expectVisibleControl(withdraw);
    }
  });
}

test('main navigation searches public keyword ranking and prefills a new stake', async ({
  page,
}) => {
  const legacyPage = await page.request.get(`${siteBase}/ads`);
  expect(legacyPage.status()).toBe(404);

  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"message":"Not signed in"}',
    }),
  );
  await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"message":"Not signed in"}',
    }),
  );
  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(marketStatus),
    }),
  );
  let rankingRequests = 0;
  await page.route('**/v1/keyword-market/keywords/**', (route) => {
    rankingRequests += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        keyword: decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!),
        chainStatus: 'SYNCED',
        chainId: marketStatus.chainId,
        contractAddress: marketStatus.contractAddress,
        indexedThroughBlock: marketStatus.indexedThroughBlock,
        positions: [publicPosition],
      }),
    });
  });
  let resolverRequests = 0;
  await page.route('**/v1/keyword-market/resolve**', (route) => {
    resolverRequests += 1;
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"message":"API key required"}',
    });
  });

  await page.goto(siteBase);
  const navigationToggle = page.getByRole('button', { name: 'Open navigation' });
  if (await navigationToggle.isVisible()) await navigationToggle.click();
  await page.getByRole('link', { name: 'Keyword Market' }).click();
  await expect(page).toHaveURL(marketBase);
  if (await navigationToggle.isVisible()) await navigationToggle.click();
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primaryNavigation.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: 'Community' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: 'Funding' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: 'About' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PRE Keyword Market home' })).toBeVisible();
  const marketNavigation = page.getByRole('navigation', {
    name: 'PRE Keyword Market navigation',
  });
  await expect(marketNavigation.getByRole('link', { name: 'Search', exact: true })).toBeVisible();
  await expect(marketNavigation.getByRole('link', { name: 'Campaigns' })).toBeVisible();
  await expect(marketNavigation.getByRole('link', { name: 'Moderation' })).toHaveCount(0);
  await expect(marketNavigation.getByRole('link', { name: 'API keys' })).toHaveCount(0);
  await page.getByLabel('Search query').fill('  BITCOIN—Poland xyz  ');
  const newStake = page.getByRole('link', { name: 'New stake', exact: true });
  await expect(newStake).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New stake', exact: true })).toHaveCount(0);
  await expect(page.locator('.keyword-market-resolver-empty-icon')).toHaveCount(0);
  expect(rankingRequests).toBe(0);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keyword ranking' })).toBeVisible();
  const stake = page
    .locator('.keyword-market-ranking-ledger .keyword-market-ledger-row > span')
    .nth(2);
  await expect(stake.locator('strong')).toHaveText('2.5');
  await expect(stake.locator('small')).toHaveText('PRE');
  await expect(newStake).toHaveAttribute(
    'href',
    '/keyword-market/campaigns/new?keyword=bitcoin%20poland%20xyz',
  );
  expect(rankingRequests).toBe(1);
  await expect(page.getByText(creative.headline, { exact: true })).toHaveCount(0);
  expect(resolverRequests).toBe(0);
  await newStake.click();
  await expect(page.getByLabel('Search phrase')).toHaveValue('bitcoin poland xyz');
});

test('search places Edit on the owned stake even when a competitor leads', async ({ page }) => {
  await routeSignedInSession(page);
  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(marketStatus) }),
  );
  await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([campaign]) }),
  );
  let rankingRequests = 0;
  await page.route('**/v1/keyword-market/keywords/**', (route) => {
    rankingRequests += 1;
    const keyword = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        keyword,
        chainStatus: 'SYNCED',
        chainId: marketStatus.chainId,
        contractAddress: marketStatus.contractAddress,
        indexedThroughBlock: marketStatus.indexedThroughBlock,
        positions:
          keyword === campaign.keyword
            ? [publicPosition, { ...publicPosition, rank: 2, stakerAddress: address }]
            : [publicPosition],
      }),
    });
  });
  await page.goto(marketBase);
  await expect(
    page
      .getByRole('navigation', { name: 'PRE Keyword Market navigation' })
      .getByRole('link', { name: 'API keys' }),
  ).toHaveCount(0);
  await page.getByLabel('Search query').fill('  BITCOIN—Poland  ');
  const edit = page.getByRole('link', { name: 'Edit', exact: true });
  const newStake = page.getByRole('link', { name: 'New stake', exact: true });
  await expect(edit).toHaveCount(0);
  await expect(newStake).toHaveCount(0);
  await expect(page.locator('.keyword-market-resolver-empty-icon')).toHaveCount(0);
  expect(rankingRequests).toBe(0);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page
      .locator('.keyword-market-ranking-ledger .keyword-market-ledger-row > span')
      .nth(2)
      .locator('strong'),
  ).toHaveText('2.5');
  const rows = page.locator('.keyword-market-ranking-ledger .keyword-market-ledger-row');
  await expect(rows.nth(0).getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(rows.nth(1).getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute(
    'href',
    `/keyword-market/campaigns/${campaignId}`,
  );
  await expect(
    page.locator('.keyword-market-result-heading-actions').getByRole('link', { name: 'Edit' }),
  ).toHaveCount(0);
  await page.getByLabel('Search query').fill('bitcoin poland xyz');
  await expect(
    page.getByRole('region', { name: `USD bid ranking for ${campaign.keyword}` }),
  ).toBeVisible();
  await expect(edit).toHaveAttribute('href', `/keyword-market/campaigns/${campaignId}`);
  await expect(newStake).toHaveCount(0);
  expect(rankingRequests).toBe(1);
  await page.getByLabel('Search query').press('Enter');
  await expect(
    page.getByRole('region', { name: 'USD bid ranking for bitcoin poland xyz' }),
  ).toBeVisible();
  await expect(edit).toHaveCount(0);
  await expect(newStake).toHaveAttribute(
    'href',
    '/keyword-market/campaigns/new?keyword=bitcoin%20poland%20xyz',
  );
  expect(rankingRequests).toBe(2);
  await page.getByLabel('Search query').fill(campaign.keyword);
  await expect(newStake).toHaveAttribute(
    'href',
    '/keyword-market/campaigns/new?keyword=bitcoin%20poland%20xyz',
  );
  await expect(edit).toHaveCount(0);
  expect(rankingRequests).toBe(2);
  await page.getByLabel('Search query').press('Enter');
  await expect(edit).toHaveAttribute('href', `/keyword-market/campaigns/${campaignId}`);
  await expect(newStake).toHaveCount(0);
  expect(rankingRequests).toBe(3);
  await edit.click();
  await expect(page).toHaveURL(`${marketBase}/campaigns/${campaignId}`);
});

test('SUPER_ADMIN navigation opens API key management', async ({ page }) => {
  await routeSignedInSession(page, ['SUPER_ADMIN']);
  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(marketStatus) }),
  );
  await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/v1/keyword-market/admin/api-keys', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.goto(marketBase);
  const navigation = page.getByRole('navigation', { name: 'PRE Keyword Market navigation' });
  await expect(navigation.getByRole('link', { name: 'API keys' })).toBeVisible();
  await navigation.getByRole('link', { name: 'API keys' }).click();
  await expect(page).toHaveURL(`${marketBase}/api-keys`);
  await expect(page.getByRole('heading', { name: 'API keys.' })).toBeVisible();
  await expect(page.getByText('No API keys yet')).toBeVisible();
});

test('advertiser flow keeps stake disabled while creative management works', async ({ page }) => {
  await routeSignedInSession(page);
  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'AWAITING_CONTRACT',
        chainId: 8453,
        contractAddress: null,
        deploymentBlock: null,
        transactionsEnabled: false,
        indexedThroughBlock: null,
        minimumStakeRaw: null,
        preTokenAddress: '0x0000000000000000000000000000000000000001',
      }),
    }),
  );
  await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([campaign]) }),
  );
  await page.route('**/v1/keyword-market/campaigns', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: campaignId, keyword: campaign.keyword, revisionId }),
    });
  });

  await page.goto(`${marketBase}/campaigns`);
  await expect(page.getByText('bitcoin poland', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: /bitcoin poland/i }).click();
  await expect(page.getByRole('button', { name: 'Stake', exact: true })).toBeDisabled();
  await expect(page.getByLabel('USD bid per click')).toBeDisabled();
  await expect(
    page.getByText('AWAITING CONTRACT — transactions disabled', { exact: true }),
  ).toBeVisible();

  await page.goto(`${marketBase}/campaigns/new`);
  await page.getByLabel('Search phrase').fill('  BITCOIN—Poland  ');
  await expect(
    page.locator('.keyword-market-normalized-keyword').getByText('bitcoin poland'),
  ).toBeVisible();
  await page.getByLabel(/Headline/).fill(creative.headline);
  await page.getByLabel(/Description/).fill(creative.description);
  await page.getByLabel(/HTTPS destination/).fill(creative.destinationUrl);
  await page.getByRole('button', { name: 'Create and submit' }).click();
  await expect(page).toHaveURL(`${marketBase}/campaigns/${campaignId}`);
});

test('advertiser edits on a separate page and reopens the saved pending changes', async ({
  page,
}) => {
  await routeSignedInSession(page);
  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(marketStatus) }),
  );
  let savedRevision: typeof creative | null = null;
  await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          ...campaign,
          pendingRevision: savedRevision,
          revisions: savedRevision ? [savedRevision, creative] : [creative],
        },
      ]),
    }),
  );
  const updatedCreative = {
    headline: 'Updated Bitcoin result',
    description: 'Updated campaign description.',
    destinationUrl: 'https://example.com/updated-bitcoin',
  };
  const submittedCreatives: unknown[] = [];
  await page.route(`**/v1/keyword-market/campaigns/${campaignId}/revisions`, (route) => {
    expect(route.request().method()).toBe('POST');
    submittedCreatives.push(route.request().postDataJSON());
    savedRevision = {
      ...creative,
      ...updatedCreative,
      id: '00000000-0000-4000-8000-000000000103',
      version: 2,
      status: 'PENDING_REVIEW',
    };
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ revisionId: savedRevision.id, version: 2 }),
    });
  });

  await page.goto(`${marketBase}/campaigns/${campaignId}`);
  const edit = page.getByRole('link', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  await expect(edit).toHaveAttribute('href', `/keyword-market/campaigns/${campaignId}/edit`);
  await edit.click();
  await expect(page).toHaveURL(`${marketBase}/campaigns/${campaignId}/edit`);
  await expect(page.getByRole('heading', { name: 'Edit campaign', exact: true })).toBeVisible();
  const editor = page.locator('.keyword-market-editor-grid');
  await expect(editor.getByLabel('Search phrase')).toHaveValue(campaign.keyword);
  await expect(editor.getByLabel('Search phrase')).toHaveJSProperty('readOnly', true);
  const headline = editor.getByLabel(/^Headline/);
  await expect(headline).toHaveValue(creative.headline);
  await expect(headline).toBeFocused();
  await expect(headline).toBeInViewport();
  await expect(editor.getByLabel(/^Description/)).toHaveValue(creative.description);
  await expect(editor.getByLabel(/^HTTPS destination/)).toHaveValue(creative.destinationUrl);
  await headline.fill(updatedCreative.headline);
  await editor.getByLabel(/^Description/).fill(updatedCreative.description);
  await editor.getByLabel(/^HTTPS destination/).fill(updatedCreative.destinationUrl);
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(`${marketBase}/campaigns/${campaignId}`);
  expect(submittedCreatives).toEqual([updatedCreative]);
  await expect(page.locator('.keyword-market-revision-row').first()).toContainText(
    updatedCreative.headline,
  );
  await expect(page.locator('.keyword-market-campaign-primary')).toContainText(creative.headline);

  await edit.click();
  await expect(page).toHaveURL(`${marketBase}/campaigns/${campaignId}/edit`);
  await page.reload();
  await expect(headline).toHaveValue(updatedCreative.headline);
  await expect(editor.getByLabel(/^Description/)).toHaveValue(updatedCreative.description);
  await expect(editor.getByLabel(/^HTTPS destination/)).toHaveValue(updatedCreative.destinationUrl);
  await headline.fill('Unsaved changes are discarded by Cancel');
  await editor.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(`${marketBase}/campaigns/${campaignId}`);
  expect(submittedCreatives).toEqual([updatedCreative]);
  await edit.click();
  await expect(headline).toHaveValue(updatedCreative.headline);
});

test('campaign edit retains the draft when saving fails', async ({ page }) => {
  await routeSignedInSession(page);
  await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([campaign]) }),
  );
  await page.route(`**/v1/keyword-market/campaigns/${campaignId}/revisions`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Creative could not be saved. Try again.' }),
    }),
  );

  await page.goto(`${marketBase}/campaigns/${campaignId}/edit`);
  const headline = page.getByLabel(/^Headline/);
  await headline.fill('Draft retained after a failed save');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText('Creative could not be saved. Try again.', { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${marketBase}/campaigns/${campaignId}/edit`);
  await expect(headline).toHaveValue('Draft retained after a failed save');
  await expect(page.getByLabel(/^Description/)).toHaveValue(creative.description);
  await expect(page.getByLabel(/^HTTPS destination/)).toHaveValue(creative.destinationUrl);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});

test('campaign edit retains the draft after signing in again to retry a save', async ({ page }) => {
  await routeSignedInSession(page);
  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(marketStatus) }),
  );
  let campaignRequests = 0;
  await page.route('**/v1/keyword-market/campaigns/mine', (route) => {
    campaignRequests += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([campaign]) });
  });
  const submittedCreatives: unknown[] = [];
  await page.route(`**/v1/keyword-market/campaigns/${campaignId}/revisions`, (route) => {
    submittedCreatives.push(route.request().postDataJSON());
    return route.fulfill(
      submittedCreatives.length === 1
        ? {
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Session expired' }),
          }
        : {
            contentType: 'application/json',
            body: JSON.stringify({
              revisionId: '00000000-0000-4000-8000-000000000103',
              version: 2,
            }),
          },
    );
  });
  const draft = {
    headline: 'Campaign draft survives signing in again',
    description: 'Keep every edited field after the campaign wallet signs in again.',
    destinationUrl: 'https://example.com/session-retry',
  };

  await page.goto(`${marketBase}/campaigns/${campaignId}/edit`);
  await page.getByLabel(/^Headline/).fill(draft.headline);
  await page.getByLabel(/^Description/).fill(draft.description);
  await page.getByLabel(/^HTTPS destination/).fill(draft.destinationUrl);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText('Sign in with the campaign wallet to save your changes.', { exact: true }),
  ).toBeVisible();
  const requestsBeforeSignIn = campaignRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('precommunity:auth-changed')));
  await expect.poll(() => campaignRequests).toBeGreaterThan(requestsBeforeSignIn);
  await expect(page.getByLabel(/^Headline/)).toBeVisible();
  await expect(page.getByLabel(/^Headline/)).toHaveValue(draft.headline);
  await expect(page.getByLabel(/^Description/)).toHaveValue(draft.description);
  await expect(page.getByLabel(/^HTTPS destination/)).toHaveValue(draft.destinationUrl);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(`${marketBase}/campaigns/${campaignId}`);
  expect(submittedCreatives).toEqual([draft, draft]);
});

for (const access of [
  {
    name: 'signed out',
    status: 401,
    body: '{"message":"Not signed in"}',
    message: 'Sign in with the campaign wallet',
  },
  { name: 'not owned', status: 200, body: '[]', message: 'Campaign not found' },
]) {
  test(`campaign edit hides the form when the campaign is ${access.name}`, async ({ page }) => {
    if (access.status === 200) await routeSignedInSession(page);
    else
      await page.route('**/v1/auth/me', (route) =>
        route.fulfill({ status: 401, contentType: 'application/json', body: access.body }),
      );
    await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
      route.fulfill({ status: access.status, contentType: 'application/json', body: access.body }),
    );

    await page.goto(`${marketBase}/campaigns/${campaignId}/edit`);
    await expect(page.getByText(access.message, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByLabel(/^Headline/)).toHaveCount(0);
  });
}

test('campaign updates from indexed external stake while preserving the bid draft', async ({
  page,
}) => {
  await page.clock.install();
  await routeSignedInSession(page);
  const contractAddress = '0x0000000000000000000000000000000000000099';
  let externalStakeIndexed = false;
  let campaignRequests = 0;
  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'SYNCED',
        chainId: 8453,
        contractAddress,
        deploymentBlock: '1',
        transactionsEnabled: true,
        indexedThroughBlock: externalStakeIndexed ? '20' : '10',
        minimumStakeRaw: '1000000000000000000',
        preTokenAddress: '0x0000000000000000000000000000000000000001',
      }),
    }),
  );
  await page.route('**/v1/keyword-market/campaigns/mine', (route) => {
    campaignRequests += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          ...campaign,
          chainStatus: 'SYNCED',
          leaderBidUsdRaw: externalStakeIndexed ? '750000' : null,
          bidNeededToLeadUsdRaw: externalStakeIndexed ? '0' : null,
          position: externalStakeIndexed
            ? {
                rank: 1,
                stakerAddress: address,
                stakeRaw: '2500000000000000000',
                bidUsdRaw: '750000',
                requiredCoveragePreRaw: '1',
                eligible: true,
                withdrawAvailableAt: '0',
                positionVersion: '1',
                amountSinceBlock: '18',
                amountSinceLogIndex: 1,
                positionBlock: '18',
                positionTxHash: `0x${'3'.repeat(64)}`,
                hasEligibleAd: true,
              }
            : null,
        },
      ]),
    });
  });

  await page.goto(`${marketBase}/campaigns/${campaignId}`);
  const positionPanel = page.locator('.keyword-market-stake-panel');
  await expect(positionPanel.getByText('0 PRE', { exact: true })).toBeVisible();
  await expect(positionPanel.locator('.keyword-market-rank-number')).toHaveText('—');
  await page.getByLabel('USD bid per click').fill('');
  const requestsBeforeStake = campaignRequests;

  externalStakeIndexed = true;
  await page.clock.fastForward(15_001);

  await expect(positionPanel.getByText('2.5 PRE', { exact: true })).toBeVisible();
  await expect(positionPanel.locator('.keyword-market-rank-number')).toHaveText('#1');
  expect(campaignRequests).toBeGreaterThan(requestsBeforeStake);
  await expect(page.getByLabel('USD bid per click')).toHaveValue('');
});

test('advertiser can request exit while syncing and sees the 24-hour wait', async ({ page }) => {
  await routeSignedInSession(page);
  const contractAddress = '0x0000000000000000000000000000000000000099';
  const availableAt = Math.floor(Date.now() / 1000) + 3_600;
  let pending = false;
  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'SYNCING',
        chainId: 8453,
        contractAddress,
        deploymentBlock: '1',
        transactionsEnabled: false,
        indexedThroughBlock: '10',
        minimumStakeRaw: '1000000000000000000',
        preTokenAddress: '0x0000000000000000000000000000000000000001',
      }),
    }),
  );
  await page.route('**/v1/keyword-market/campaigns/mine', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          ...campaign,
          chainStatus: 'SYNCING',
          position: {
            rank: 1,
            stakerAddress: address,
            stakeRaw: '1000000000000000000',
            bidUsdRaw: '100000',
            eligible: !pending,
            withdrawAvailableAt: pending ? String(availableAt) : '0',
            positionVersion: '1',
            amountSinceBlock: '8',
            amountSinceLogIndex: 1,
            positionBlock: '8',
            positionTxHash: `0x${'2'.repeat(64)}`,
            hasEligibleAd: true,
          },
        },
      ]),
    }),
  );

  await page.goto(`${marketBase}/campaigns/${campaignId}`);
  await expect(page.getByRole('button', { name: 'Request unstake' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Update stake / bid' })).toBeDisabled();
  pending = true;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Request unstake' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdraw PRE' })).toBeDisabled();
  await expect(page.getByText(/Withdrawal available/)).toBeVisible();
  await expect(page.getByText(/earlier clicks may still be charged/)).toBeVisible();
});

test('moderator reviews revisions and grouped reports in the keyword market', async ({ page }) => {
  await routeSignedInSession(page);
  const adminRevision = {
    ...creative,
    status: 'PENDING_REVIEW',
    keyword: campaign.keyword,
    advertiserAddress: address,
    reportCount: '2',
    proof: null,
  };
  const reports = [
    {
      revision: adminRevision,
      reports: [
        {
          id: '00000000-0000-4000-8000-000000000103',
          reason: 'MISLEADING',
          comment: 'The landing page makes a different claim.',
          createdAt: '2026-08-24T12:00:00.000Z',
        },
      ],
    },
  ];
  await page.route('**/v1/keyword-market/admin/revisions?**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([adminRevision]) }),
  );
  await page.route('**/v1/keyword-market/admin/reports?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: reports.map((group) => ({
          ...group,
          matchingReportCount: String(group.reports.length),
          reportsTruncated: false,
        })),
        nextCursor: null,
      }),
    }),
  );
  await page.route('**/v1/keyword-market/admin/audit', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '00000000-0000-4000-8000-000000000104',
          actorAddress: address,
          entityId: revisionId,
          action: 'AD_REVISION_APPROVE',
          before: { status: 'PENDING_REVIEW' },
          after: { status: 'APPROVED' },
          createdAt: '2026-08-24T12:30:00.000Z',
        },
      ]),
    }),
  );
  let approved = false;
  await page.route(`**/v1/keyword-market/admin/revisions/${revisionId}/moderate`, (route) => {
    approved = true;
    return route.fulfill({ status: 200, body: '{}' });
  });

  await page.goto(`${marketBase}/admin`);
  await expect(
    page
      .getByRole('navigation', { name: 'PRE Keyword Market navigation' })
      .getByRole('link', { name: 'Moderation' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ad moderation.' })).toBeVisible();
  await expect(page.getByText('The landing page makes a different claim.')).toBeVisible();
  await expect(page.getByText('AD REVISION APPROVE')).toBeVisible();
  await page.getByPlaceholder('Moderator note').fill('Destination reviewed.');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => approved).toBe(true);
});
