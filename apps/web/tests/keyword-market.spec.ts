import { expect, test, type Page } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const siteBase = `http://127.0.0.1:${port}`;
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
  leaderStakeRaw: null,
  stakeNeededToLeadRaw: null,
  activeRevision: creative,
  pendingRevision: null,
  revisions: [creative],
  createdAt: '2026-08-24T12:00:00.000Z',
  updatedAt: '2026-08-24T12:00:00.000Z',
};

async function routeSignedInSession(page: Page) {
  await page.route('**/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ address, roles: ['CONTENT_ADMIN'] }),
    }),
  );
}

test('main navigation opens the keyword market resolver and reports a result', async ({ page }) => {
  const legacyPage = await page.request.get(`${siteBase}/ads`);
  expect(legacyPage.status()).toBe(404);

  await page.route('**/v1/keyword-market/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'SYNCED',
        chainId: 8453,
        contractAddress: '0x0000000000000000000000000000000000000099',
        deploymentBlock: '1',
        transactionsEnabled: true,
      }),
    }),
  );
  await page.route('**/v1/keyword-market/resolve?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: 'request-1',
        algorithmVersion: 'keyword-longest-v1',
        ad: {
          revisionId,
          headline: creative.headline,
          description: creative.description,
          destinationUrl: creative.destinationUrl,
          displayDomain: creative.displayDomain,
          matchedKeyword: 'bitcoin poland',
          proof: {
            chainId: 8453,
            contractAddress: '0x0000000000000000000000000000000000000099',
            stakerAddress: address,
            stakeRaw: '900',
            positionBlock: '88',
            positionTxHash: `0x${'2'.repeat(64)}`,
            indexedThroughBlock: '120',
          },
        },
      }),
    }),
  );
  await page.route(`**/v1/keyword-market/revisions/${revisionId}/reports`, (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{"accepted":true}' }),
  );

  await page.goto(siteBase);
  await page.getByRole('link', { name: 'Keyword Market' }).click();
  await expect(page).toHaveURL(marketBase);
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primaryNavigation.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: 'Community' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: 'Funding' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: 'About' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PRE Keyword Market home' })).toBeVisible();
  const marketNavigation = page.getByRole('navigation', {
    name: 'PRE Keyword Market navigation',
  });
  await expect(marketNavigation.getByRole('link', { name: 'Resolver' })).toBeVisible();
  await expect(marketNavigation.getByRole('link', { name: 'Campaigns' })).toBeVisible();
  await expect(marketNavigation.getByRole('link', { name: 'Moderation' })).toHaveCount(0);
  await page.getByLabel('Search query').fill('bitcoin poland xyz');
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByRole('heading', { name: creative.headline })).toBeVisible();
  await expect(page.getByText('bitcoin poland', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Report ad' }).click();
  await page
    .getByPlaceholder('Optional context for the moderator')
    .fill('Please review this result.');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('button', { name: 'Report received' })).toBeVisible();
});

test('advertiser flow keeps stake disabled while creative management works', async ({ page }) => {
  await routeSignedInSession(page);
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
  await expect(page.getByRole('button', { name: 'Create stake' })).toBeDisabled();
  await expect(page.getByText(/AWAITING_CONTRACT/)).toBeVisible();

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
