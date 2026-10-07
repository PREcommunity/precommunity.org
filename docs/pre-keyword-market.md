# PRE Keyword Market operations and production release

PRE Keyword Market runs at `/keyword-market` on the main application origin using the existing web, API, worker, PostgreSQL and Redis processes. It does not introduce a separate service. The API reports `AWAITING_CONTRACT` while the contract address and deployment block are absent, `SYNCING` until the worker completes a fresh finalized scan, and `SYNCED` afterwards. Opening, topping up and repricing a stake are enabled only in the final state; withdrawal requests and claims remain available whenever the contract is configured.

In the local MAMP Pro setup, the browser-facing address is `https://precommunity.test/keyword-market`. Port `3011` remains only the internal Next.js proxy target and is not part of the SIWE origin.

## Public surface

- `GET /v1/keyword-market/status` — chain adapter status and transaction availability.
- `GET /v1/keyword-market/keywords/:keyword` — public stake ranking and chain proof without competitor creative content.
- `POST /v1/keyword-market/revisions/:revisionId/reports` — anonymous report intake; callers receive the same generic `202` response.
- `GET /v1/keyword-market/revisions/:revisionId/click` — records a click and redirects with `302` to the stored HTTPS destination. No API key is required for opening the link.

The co-hosted web client reaches these endpoints through the existing `/api/v1/keyword-market/...` proxy prefix.

The resolver normalizes with Unicode NFKC, lowercases, treats punctuation as a separator and matches only whole-token phrases. Algorithm `keyword-longest-v2` keeps candidate priority as most tokens, longest phrase, earliest occurrence, then lexical order. Within a keyword, eligible positions rank by the highest USD bid per click (six decimal places), then staker address. Positions pending withdrawal remain visible with `eligible: false` but cannot lead or resolve. A leader without an active approved creative is skipped before the resolver tries a shorter keyword.

Resolver responses, keyword rankings and click redirects are `no-store`. Nginx applies a dedicated resolver limit and logs `$uri`, never the query string or raw client address. Metrics use best-effort Redis counters; the worker flushes idempotent batches into daily and lifetime PostgreSQL metrics. Counter failure cannot fail ad delivery or prevent a redirect.

## Search-engine integration and API keys

The website's Search shows the exact normalized keyword's public stake ranking. It does not request ads or add Views. New stake opens a prefilled campaign form, and Edit opens the signed-in advertiser's existing campaign, including pending, paused and unstaked campaigns. Stake values are displayed as PRE using 18 decimals; API and blockchain amounts remain raw integer strings.

SUPER_ADMIN manages named integration keys at `/keyword-market/api-keys`. Each search engine receives its own key. The full credential is displayed once after creation; only its SHA-256 digest and a masked display prefix are stored. Keys do not expire automatically. Create a replacement before revoking an old key. Revocation takes effect on the next API request, independently of the other keys.

The management endpoints require an authenticated SUPER_ADMIN wallet session:

- `GET /v1/keyword-market/admin/api-keys` returns name, prefix, status timestamps and last use, never the credential or digest.
- `POST /v1/keyword-market/admin/api-keys` with `{ "name": "Search engine name" }` returns `201` with metadata and the one-time `apiKey`. Names are trimmed and must have 1–80 characters.
- `DELETE /v1/keyword-market/admin/api-keys/:id` revokes a key and returns `204`; repeating revocation is safe.

`GET /v1/keyword-market/resolve?q=...` requires `X-API-Key`. Make this request from the search engine's server, keeping the key out of browser bundles, URLs and logs. Missing, invalid and revoked keys receive `401` before ad selection. An unavailable key store returns `503`. The response remains `{ requestId, algorithmVersion, ad }`, with `ad: null` when there is no eligible result. Ad responses now include an absolute `clickUrl` through precommunity in addition to `destinationUrl` and `displayDomain`.

```http
GET /api/v1/keyword-market/resolve?q=bitcoin HTTP/1.1
Host: precommunity.org
X-API-Key: <key copied once from the API keys page>
```

Use `ad.clickUrl` for the advertisement's link and `ad.displayDomain` for its visible domain. A returned link has the form `https://precommunity.org/api/v1/keyword-market/revisions/<revisionId>/click`. It stays tied to that version's original destination after a creative replacement. Approved and previously approved superseded revisions redirect; missing, pending, rejected, suspended and unpublished superseded revisions return `404`. Redirect targets cannot be supplied by callers.

Views count authorized GET deliveries containing an ad, including resolver cache hits; they measure delivery rather than visibility in a browser. Clicks count regular GET navigations through `clickUrl`. HEAD requests and explicit prefetch/prerender requests add neither metric. There is no browser click beacon or display-event endpoint. Each campaign's lifetime Views and Clicks sum all of its creative revisions and all search engines. Existing resolution metrics remain separate; historical resolution counts are not backfilled as Views or Clicks. New analytics begin at zero and become visible after the worker's next minute-level flush.

The campaign list filters keywords locally and displays 20 records per page. Search resets the page; refresh preserves the filter and clamps the current page when records disappear.

Deploy `20261007120000_keyword_market_keys_and_analytics` first, then deploy the generated database client, updated worker and API, and finally the web client. Create integration keys as SUPER_ADMIN after deployment. No environment API-key secret is needed: keys are managed in PostgreSQL. Migrations and runtime service changes are operator actions; repository changes do not apply them automatically.

## Authenticated and moderator surface

Advertiser endpoints require the SIWE session for the same wallet that owns the campaign. The market and community surfaces share one SIWE origin and one host-only `HttpOnly` session cookie with `Path=/`, so signing in or out applies to every application path without exposing the cookie to sibling subdomains.

- Advertisers can create one campaign per wallet and normalized keyword, submit immutable creative revisions, pause/resume, see ranking/proof, leader gap and campaign-wide lifetime Views/Clicks. Creative detail preserves legacy 30-day/lifetime resolutions.
- `GET /v1/keyword-market/transactions/:txHash` confirms the authenticated wallet's finalized `PositionChanged` event in Prisma. The web client matches its stored block hash to the confirmed receipt, so a later charge is accepted while a transaction removed by reorg is not reported as indexed.
- Advertisers can prepare `stake`, `requestUnstake` and `unstake` transactions only for a campaign owned by their authenticated wallet. A stake locks PRE and sets a USD bid per click; the web client checks PRE balance and allowance, switches to the configured chain, submits an exact approval when necessary, waits for confirmations and then polls for the projected position. A withdrawal request removes the position from ranking immediately; the remaining PRE becomes claimable after 24 hours.
- An approved creative remains active while an edited revision is pending. Approval switches the active revision; rejection leaves the previous version active.
- `CONTENT_ADMIN` and `SUPER_ADMIN` can filter revision and report queues, approve/reject/suspend/restore creatives, dismiss reports, or atomically suspend a creative and close its open reports. These actions use the existing audit log.
- Reports never suspend an ad automatically. PostgreSQL stores an HMAC fingerprint rather than a raw IP. Resolved report detail and daily metrics are retained for 12 months; lifetime aggregates and audit actions remain.

## Runtime configuration

Required additions:

```dotenv
ADS_REPORT_FINGERPRINT_SECRET=<independent random secret of at least 32 characters>
ADS_CONTRACT_ADDRESS_TESTNET=<PREKeywordMarketV1 address>
ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET=<deployment block>
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<required for QR/mobile wallets>
```

`ops/configure-app-runtime.sh` creates and preserves the report HMAC secret independently from the session secret. Address and deployment block must either both be set or both remain empty. Setting the contract address and block moves the application to `SYNCING`; a successful worker scan is required before new stake preparation; withdrawal requests and claims remain preparable while the worker syncs. Staking does not require an operator or `ADS_OPERATOR_PRIVATE_KEY`. A future billing routine would require a backend-only operator key whose address the Safe registers through `setOperator`.

## Routing and Nginx

No additional DNS record or TLS certificate is required. Run the existing Nginx configuration step for the canonical domain and verify that its HTTPS virtual host preserves the dedicated `/v1/keyword-market/resolve` and `/api/v1/keyword-market/resolve` locations, `precommunity_keyword_market_resolve` rate-limit zone and `precommunity_keyword_market` privacy-safe log format from the repository template.

If an `ads` DNS record or certificate name was prepared before this migration, remove it manually after the path-based release is verified.

## Contract model

`PREKeywordMarketV1` lives in the sibling `escrow` repository. It is non-upgradeable and uses the existing 18-decimal PRE token. The Safe owner controls the minimum stake, pause state and backend operator address. The constructor's fourth argument, `startPaused`, selects the initial state. New deployments default to active on both networks; set `KEYWORD_MARKET_START_PAUSED[_TESTNET]=1` for an initially paused deployment that requires Safe unpause. The current entry point is `stake(bytes32 keywordId, uint256 amountPre, uint256 bidUsd)`: the user chooses any positive bid in six-decimal USD units per click and deposits PRE. There is no signed quote, quote nonce, external price lookup or PRE/USD conversion in the staking path. A new position must deposit at least `minimumStake`; its `requiredCoveragePre` is that opening minimum, independent of its bid. A zero-PRE stake call may update an existing bid. The operator is required only for `chargeStake`.

The application normalizes a keyword with Unicode NFKC, lowercases it, treats punctuation as a separator and collapses whitespace. Its on-chain id is `keccak256` of the canonical UTF-8 bytes. Shared test vectors cover the TypeScript and Solidity sides.

The current event order is `PositionChanged(keywordId, staker, bidUsd, eligible, newStake, positionVersion, previousStake, requiredCoveragePre, withdrawAvailableAt)`. It contains the complete state after every position mutation. The worker projects PRE amount, bid, coverage, eligibility, withdrawal timestamp and position version from events beyond the configured confirmation boundary (six blocks for Base Sepolia). It also stores block hash, transaction hash and log index as chain proof. Amounts remain raw integer strings in Prisma; timestamps and position versions remain integers.

| Mutation                                | Position event                                       | Additional events and state                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open, top up or update bid with `stake` | Always `PositionChanged`                             | `Staked` for nonzero deposits; `BidUpdated` when an existing bid changes; version increases when opening a zero-balance position.                  |
| `requestUnstake`                        | Always `PositionChanged`                             | `UnstakeRequested`; `eligible = false` and withdrawal becomes available after 24 hours.                                                            |
| `unstake`                               | Always `PositionChanged`                             | `Unstaked`; amount, bid, coverage and withdrawal time clear, while version remains.                                                                |
| First successful `chargeStake`          | Always `PositionChanged`                             | `StakeCharged`; amount decreases, eligibility updates and a zero balance clears the position. A repeated charge id is a no-op without a new event. |
| Winner or winning bid changes           | `PositionChanged` still describes the mutated wallet | `TopStakeChanged(keywordId, staker, bidUsd, previousStaker, previousBidUsd)`; it does not describe balance-only changes.                           |
| Safe configuration changes              | No position event                                    | `MinimumStakeUpdated`, `OperatorUpdated`, `Paused` or `Unpaused`; existing positions retain their opening coverage.                                |

## Database synchronization and wallet ownership

The worker scans all `PositionChanged` logs from the deployment block, including stakes sent outside the website. It saves every position by `(chainId, contractAddress, keywordId, stakerAddress)` and deduplicates events by `(chainId, contractAddress, txHash, logIndex)`. Each batch atomically saves its event records, positions and checkpoint. A detected reorg clears and replays only `AdStakePosition`, `AdChainEvent` and `AdIndexerState`; campaigns, creatives, reports and metrics remain.

The caught-up checkpoint also stores `minimumStakeRaw`, `paused`, `operatorAddress` and `configBlockNumber`, read by the worker at the same confirmed block. The worker verifies the configured PRE token. Normal status, campaign and ranking reads use Prisma rather than per-visitor blockchain calls. Backend RPC reads remain necessary when preparing a transaction to validate its current state; the browser reads PRE balance and allowance when sending a stake and waits for its transaction receipt. After submission, the page refreshes its API-backed view until the worker projects the confirmed change.

The event identifies the wallet, not an application user id. SIWE verifies the same normalized address stored in `User.address`; the API associates the indexed position with that wallet and any matching campaign by keyword hash. Unknown wallets are retained without creating a user or campaign. An authenticated advertiser can subsequently create a campaign for an already indexed stake. `keywordId` is a hash: neither the plaintext keyword nor a creative can be recovered from the event. The application supplies canonical keyword text through campaign creation or keyword lookup and computes its hash.

`topStakeOf(keywordId)` exposes the highest eligible USD bid. `requestUnstake(keywordId)` deactivates the position immediately and starts a fixed 24-hour wait. `unstake(keywordId)` transfers the remaining PRE after that wait; opening or increasing a stake while its withdrawal is pending is rejected. The operator may charge during the wait, including while the contract is paused, using the position version and a unique charge id. A duplicate charge id is a no-op; a stale position version is rejected. A charge uses the smaller of the requested PRE and the remaining stake, so an insufficient position reaches zero without underflow. Charged PRE accrues in the contract until the Safe withdraws it with `withdrawAccrued`. The Safe can revoke the operator. The application records delivered ads and redirect clicks as non-billing metrics. PRE/USD conversion and periodic charge submission remain future backend billing work.

The deployment default minimum is `1 PRE`, configurable with `KEYWORD_MARKET_MINIMUM_PRE_TESTNET`. A later Safe change applies to newly opened positions. There are no on-chain price feeds or automatic click counters.

## Contract and deployment release gates

The reviewed implementation fixes the five named event fields and uses an indexed maximum heap: position insert/update/removal is O(log n), and leader lookup is O(1). The public three-argument stake and exact PositionChanged shape are preserved. Contract tests decode named event fields, replay positions, compare mutations against an independent model and measure gas at 16, 128 and 1024 positions. The 1024-position mutation budget is 1,500,000 gas. CI uploads `keyword-market-gas-<commit>-<attempt>` with `reports/keyword-market-gas.json`; the report must come from the exact release revision. Compilation alone does not satisfy the runtime test gate.

The first release has no paid click settlement. USD bids are declarations used for ranking; a position's PRE opening minimum is independent of the bid. Leave the operator at zero and do not provision ADS_OPERATOR_PRIVATE_KEY. Preserve the 24-hour withdrawal delay.

The application ABI must match the selected compiled contract, including named event fields and `topStakeOf` tuple `(staker, amount, bidUsd, positionVersion, requiredCoveragePre)`. Refresh only this contract with:

```bash
node packages/shared/scripts/sync-escrow-abi.mjs --contract=PREKeywordMarketV1
```

### Sepolia rehearsal before Base

Use the testnet PRE/Safe configuration and deployer keystore in `../escrow`. Deploy, verify the active contract and publish its source. The operator's two wallets must cover deposit, bid-only increase/decrease, competition, external website-independent stake and requestUnstake; retain receipts and verify the remaining PRE withdrawal after the real 24-hour delay. Run the app indexer and all checks against a separate testnet database, without changing the production network.

```bash
pnpm deploy:keyword-market --network testnet
pnpm check:keyword-market --network testnet
pnpm verify:keyword-market --network testnet
# Default active deployment needs no initial Safe transaction.
KEYWORD_MARKET_CHECK_STAGE=active pnpm check:keyword-market --network testnet
```

The implementation agent may run Hardhat unit tests using the test runner's in-process EVM. Local servers and services, including the browser fixture, web/API/worker processes, standalone blockchain nodes, PostgreSQL and Redis, remain operator- or CI-managed. Browser tests against operator-started fixtures use `PLAYWRIGHT_EXTERNAL_SERVERS=1`; this disables Playwright server management and preserves the running web server's cache. A successful simulated-time contract test does not replace the 24-hour live rehearsal.

### Real local Sepolia rehearsal

`pnpm prepare:sepolia` reads the confirmed marketplace manifest from `../escrow/.deployments/base-sepolia.keyword-market-v1.json` and writes the ignored, private `.env.keyword-rehearsal` profile. It preserves the main `.env`. The profile selects Base Sepolia, 12 application confirmations, the existing Sepolia escrow, schema `keyword_rehearsal_20261007`, an isolated Redis on `127.0.0.1:6382` database 2, API port 4012 and web port 3012. Both database and Redis fallback variables are overridden. Launch aliases clear inherited shell variables before loading this profile.

Initialize the fresh schema once, after confirming that it does not already contain a rehearsal:

```bash
pnpm prepare:sepolia
pnpm build:packages
pnpm --filter @precommunity/api build
pnpm --filter @precommunity/worker build
pnpm db:migrate:sepolia
pnpm db:seed:sepolia
pnpm worker:backfill:sepolia --phase active
```

The preparation command does not create, reset or migrate a database, and the launch commands do not install dependencies. Database commands target only the selected rehearsal schema. The generic backfill also reads the existing escrow history; its checkpoint advances in bounded batches and resumes after an RPC failure. Both indexers limit `eth_getLogs` requests to 500 blocks for the public Base RPC.

The operator starts the isolated Redis in its own terminal, using the already installed MAMP binary:

```bash
/Applications/MAMP/Library/bin/redis-server --bind 127.0.0.1 --port 6382 --save "" --appendonly no
```

This is an ephemeral rehearsal cache; positions and transaction proofs are stored durably in PostgreSQL and can be replayed from the chain. It does not use the ordinary application's Redis port.

After the initial backfill finishes, the operator leaves three additional terminals running:

```bash
pnpm dev:sepolia:api
```

```bash
pnpm dev:sepolia:worker
```

```bash
pnpm dev:sepolia:web
```

The same launch aliases work from `apps/web`. The web launcher parses the rehearsal profile into the child environment instead of passing Node's `--env-file` flag, which Next would forward into `NODE_OPTIONS` and reject. Open `http://127.0.0.1:3012/keyword-market`; its SIWE domain and URI use that origin, and API calls use the same-origin `/api` proxy. Require `pnpm worker:check:sepolia --phase active` before using the application's staking flow. Enable Keyword Market only in the rehearsal project settings. Use two browser profiles so the two wallets do not share a session, and provide test PRE to both. For an intentionally paused deployment, backfill/check use `--phase preopen` until the Safe unpauses; the configured testnet Safe requires both owners to sign, and a deployer EOA cannot unpause it directly. Retain all receipts and the on-chain withdrawal availability timestamp, then claim after the actual 24-hour delay.

For a replacement Base Sepolia rehearsal deployment explicitly created with `startPaused=false`, preserve the old confirmed manifest and receipts. Store the new manifest separately as `base-sepolia.keyword-market-v1.active-rehearsal-20261007.json` by selecting deployment name `active-rehearsal-20261007` in the escrow tooling. Keep the existing rehearsal profile until the replacement manifest is confirmed. The operator stops the rehearsal API, web and worker before changing the selected contract address. Synchronize the shared ABI and pinned compiled artifact from the reviewed replacement build, then rebuild the shared package, API and worker.

Use the existing schema and profile secrets when switching:

```bash
pnpm prepare:sepolia --deployment-name active-rehearsal-20261007
pnpm worker:backfill:sepolia --phase active
pnpm worker:check:sepolia --phase active
```

Preparation stores `KEYWORD_MARKET_DEPLOYMENT_NAME_TESTNET` in the private profile, so subsequent `pnpm prepare:sepolia` calls retain the named selection. `--deployment-name ''` explicitly selects the canonical manifest. A missing or unconfirmed named manifest prevents profile replacement.

The switch retains users, wallet sessions, campaigns, approved creatives and the old contract's projection. Projection keys include the contract address, so the new deployment starts its own checkpoint and event history. Reuse the existing rehearsal schema without another initialization, migration, seed or reset. The operator relaunches the three applications with the aliases above after active readiness succeeds. Confirm that the public status shows the replacement address, `paused: false` and enabled transactions, and that the existing campaign remains owned by the same wallet. An operator address of zero permits staking; click billing still requires a Safe-approved operator.

### Browser tests with operator-started servers

The operator starts these two processes in separate terminals from this repository's root and leaves them running. The API command builds the shared package before starting the fixture on `127.0.0.1:4100`; the isolated test website uses `127.0.0.1:3100` and `.next-e2e`. Both commands require installed workspace dependencies. Workspace dependency installation is explicit: `verifyDepsBeforeRun: false` prevents pnpm from automatically reinstalling dependencies when a script is run, including while other application processes are active. CI installs with the frozen lockfile before running checks. The web launcher sets the testnet/API/RPC environment and uses `apps/web/tests/e2e-deployment.json` for the fake escrow, deployment block, owner, treasury and confirmations. The fixture and browser mocks use that same configuration, with the bundled Sepolia token addresses. These overrides are confined to the E2E launcher; the production deployment defaults remain disabled until a real deployment is configured. Restart both test processes after changing their fixture configuration.

All three shortcuts also work from `apps/web`, with the same arguments and environment.

Terminal 1:

```bash
pnpm dev:e2e:api
```

Terminal 2:

```bash
pnpm dev:e2e:web
```

After the operator confirms both are ready, the implementation agent may run the browser suite from the repository root without managing either server:

```bash
pnpm test:e2e:external
```

For static discovery without starting browsers or contacting the servers, append `--list` to that command. The suite covers both desktop and mobile. Test-file filters and other Playwright arguments are forwarded, for example `pnpm test:e2e:external keyword-market.spec.ts`. To use another web port, set the same `PLAYWRIGHT_PORT` for `dev:e2e:web` and `test:e2e:external`; the API fixture remains on port 4100. Stop each server with Ctrl+C in its terminal.

The independent marketplace UI scenarios can also use an existing website with Keyword Market enabled. `PLAYWRIGHT_BASE_URL` overrides the test URL; use `localhost` when the existing Next dev server does not allow `127.0.0.1` as a dev origin. Intentional API writes in these scenarios are mocked, and no wallet transactions are sent. This subset does not replace the full fixture-backed community suite.

```bash
PLAYWRIGHT_EXTERNAL_SERVERS=1 PLAYWRIGHT_BASE_URL=http://localhost:3011 \
node apps/web/scripts/test-e2e.mjs keyword-market.spec.ts
```

### Base mainnet contract

Use chain 8453, PRE `0x3816dD4bd44c8830c2FA020A5605bAC72FA3De7A`, Safe `0x01f3B3AF1d8B6c1E6Dd489a2E67D150C19Aa3c49` and initial minimum 1 PRE. Verify the Safe owners/threshold and token on the selected network before deployment. The constructor owns directly to Safe and defaults to active staking (`startPaused=false`); there is no deployer ownership handoff or initial unpause transaction. Set `KEYWORD_MARKET_START_PAUSED=1` to choose a paused deployment instead. Internal review and passing tests are the chosen release gate; external audit is not required by this release decision.

In the escrow repository `.env`, set `KEYWORD_MARKET_ALLOW_MAINNET=1`, `PRE_ADDRESS`, `SAFE_ADDRESS`, `KEYWORD_MARKET_MINIMUM_PRE=1` and the mainnet RPC. Unlock the existing mainnet deployer keystore interactively; never put its password or plaintext key in chat or the application environment.

```bash
pnpm deploy:keyword-market --network mainnet
pnpm check:keyword-market --network mainnet
pnpm verify:keyword-market --network mainnet
```

The check derives its default stage from the confirmed manifest: `active` for an active constructor, `rollout` for a paused one. `KEYWORD_MARKET_CHECK_STAGE` explicitly overrides the requested current state. Both stages verify zero operator by default, exact runtime, constructor ownership and initial pause state, deployment block, PRE and covered stakes/accrued fees. Manifests are separated by network; Base uses `.deployments/base.keyword-market-v1.json`. An optional `KEYWORD_MARKET_DEPLOYMENT_NAME[_TESTNET]` adds a validated name before `.json`, preserving earlier deployments and their locks. The script prints `ADS_CONTRACT_ADDRESS` and `ADS_CONTRACT_DEPLOYMENT_BLOCK`. Preserve them with the manifest and constructor/build identities. Ambiguous RPC submission keeps the deployment lock: reconcile the sender nonce/transaction before retrying; never remove a lock and blindly deploy again.

## Controlled application release on the existing VPS

The inspected production origin is `https://precommunity.org`, on Base with 12 application confirmations. Preserve the existing escrow address `0xcCa53814861B9589e9Ef8D5bf2be8EbC77052C3d`, deployment block 50578542, Safe, treasury, tokens and domain. Never use full-database reset or escrow replacement for this market release.

Freeze and review the source of both repositories, run CI and preserve the gas report. `ops/write-release-manifest.mjs` records both Git revisions, dirty state/source hashes, ABI SHA256, exact pinned artifact SHA256 and compiler build id. Release source transfers exclude secrets and local agent configuration. Preserve only browser-safe RPC URLs in NEXT_PUBLIC settings; backend provider credentials stay in BASE_RPC_URL.

Prepare a staged release with the confirmed contract address/block and production configuration:

```bash
PRECOMMUNITY_NETWORK=base \
PRECOMMUNITY_KEYWORD_MARKET_RELEASE=1 \
ADS_CONTRACT_ADDRESS=<confirmed-market-address> \
ADS_CONTRACT_DEPLOYMENT_BLOCK=<confirmed-deployment-block> \
bash ops/deploy-vps.sh precommunity.org
```

Preparation writes `/etc/precommunity/app.env.next` and builds an isolated release. It does not migrate, activate or restart production. Empty ADS inputs on a later same-network configuration retain the active pair. PRECOMMUNITY_BROWSER_RPC_URL optionally selects a separate public URL; its default is the network's public RPC, including recovery from legacy configurations that copied the private URL into the browser.

The operator enables maintenance and stops web/API/worker, waiting for all MainPID values to reach zero. PostgreSQL and Redis remain running. On the VPS, run the printed release path:

```bash
PRECOMMUNITY_MAINTENANCE_CONFIRMED=1 \
bash /srv/precommunity/releases/<release-id>/ops/cutover-keyword-market.sh \
     /srv/precommunity/releases/<release-id>
```

The cutover refuses a running process, changed domain/network/escrow or replacement of an already-live nonzero market. It locks the operation, captures the old release/configuration, dumps the database and verifies an actual restore in a temporary database on the existing PostgreSQL server. It preserves user, campaign, creative, report and ledger counts, applies migrations with the old worker stopped, keeps the application feature disabled and backfills the contract. Only the disposable market projections are cleared. Readiness verifies exact bytecode/ABI/token/Safe and a fresh canonical checkpoint, including artifact identities against the release manifest. Successful checks promote the staged environment and start the new release.

The default cutover phase is `active`, matching a deployment with `startPaused=false`; both backfill and readiness must confirm that the contract is unpaused. The contract accepts transactions from deployment even while maintenance is enabled and the application feature is disabled. Those application controls do not pause the blockchain. For an intentionally paused deployment, set `KEYWORD_MARKET_RELEASE_PHASE=preopen` on the cutover command; its checks instead require the contract to be paused. A phase or pause-state mismatch prevents promotion.

Readiness is independent of the public feature guard:

```bash
node apps/worker/dist/check-keyword-market.js --phase active
# Only for an intentionally paused deployment before Safe unpause:
node apps/worker/dist/check-keyword-market.js --phase preopen
```

In admin, enable Keyword Market, wait for SYNCED and verify SIWE/campaign/moderation. The default active deployment needs no initial Safe unpause. An intentionally paused deployment requires the Safe to call `unpause()` after preopen readiness and then the worker to index that change. Require active readiness and verify the two-wallet stake/ranking/withdrawal-request flow before removing maintenance. Confirm the subsequent 24-hour withdrawal. Twelve Base blocks are a reversible application confirmation boundary; reorg recovery remains enabled and must not be described as L1 finality.

### Recovery and first 30 minutes

Watch worker failures, advancing checkpoints, heartbeat age, finalized lag and exact transaction proofs. The readiness gate allows no more than 60 seconds of heartbeat age and 30 blocks of lag. `/healthz` alone does not prove database/indexer readiness. Keep previous release/configuration and the verified dump in the printed backup directory.

If migration/backfill fails, keep maintenance enabled and do not run an incompatible old worker against the changed schema. Prefer a compatible forward fix that preserves the selected contract, event history and withdrawals. An active contract may already have accepted stakes or withdrawals while the website was unavailable; maintenance or a disabled feature does not authorize restoring an old database, configuration or worker. Any recovery using the verified dump requires a separate review of schema compatibility and all subsequent chain and application activity, followed by canonical replay for the same contract before service resumes. The Safe can pause new stakes when its owners are available; a compatible worker must continue indexing and users must retain requestUnstake/unstake access. Keep the feature enabled for withdrawals once traffic has resumed. A new non-upgradeable contract requires a separate migration preserving old-contract withdrawals.

## Release verification checklist

1. Full format/lint/types, Prisma validation, unit tests and production build pass for the frozen release; contract CI supplies model/security/gas results.
2. Browser E2E covers community and marketplace on desktop and mobile; external stake/replay/reorg cases pass worker checks.
3. Sepolia receipts prove the two-wallet live flow and actual 24-hour withdrawal.
4. Base manifest/source verification passes; Safe ownership and zero operator are confirmed.
5. Staged app release preserves production domain/escrow/data; stopped-worker migration, verified backup restoration and readiness for the selected active/preopen phase pass.
6. Admin enable, SYNCED, active readiness and production two-wallet checks pass; Safe unpause is required only for an intentionally paused deployment. Observe the first 30 minutes and complete the later withdrawal.
