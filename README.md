# precommunity

Independent, chain-verified community funding for the Presearch ecosystem.

PRE holders can submit off-chain proposals, discuss them, and take part in seven-day token-weighted votes. Community content lives in PostgreSQL; only a moderator-approved goal draft can enter the existing escrow publication flow.

The public ledger is rebuilt exclusively from confirmed `PREcommunityEscrowV1` events on the configured Base network. PostgreSQL is a disposable read model: it improves query speed, but it is never the source of truth for public goals, contributions, settlement, or releases. The web application has no fixture fallback.

## Workspace

- `apps/web` - public ledger, goal details, wallet contributions, contributor profile, and administrator UI.
- `apps/api` - NestJS API for the chain projection, SIWE sessions, RBAC, canonical goal drafts, CSV exports, and neutral transaction requests.
- `apps/worker` - confirmation-aware Base/Base Sepolia indexer, reorg rebuild, escrow reconciliation, Safe proposal sync, and IPFS metadata validation.
- `packages/shared` - the canonical deployment manifest, contract ABI, public response types, and metadata schema helpers.
- `packages/database` - Prisma/PostgreSQL schema, migrations, and rebuildable chain-authority projection. The seed creates the `precommunity` project; the confirmed escrow owner is the root administrator.

## Local start

Use Node.js 22, pnpm 11.22.0, PostgreSQL, and Redis. Docker and Docker Compose are not required for local development.

On macOS, they can be installed and started with Homebrew:

```bash
brew install postgresql@18 redis
brew services start postgresql@18
brew services start redis
```

If either service is already installed by another package manager, keep that installation. Make sure PostgreSQL and Redis are reachable, then create a PostgreSQL database and role matching `DATABASE_URL` in your local `.env` (or change that URL to match your development database).

```bash
cp .env.example .env
# Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID from WalletConnect Cloud for RainbowKit mobile and QR wallets.
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:3011`. Before a public Base Sepolia deployment exists, the web application intentionally shows a zero-record ledger with `Deployment pending`. It never inserts sample amounts.

The web development wrapper clears stale `.next/dev/cache` data before starting when the configured port is free and again after a normal shutdown. The Playwright wrapper clears its isolated `.next-e2e` cache before and after every E2E run, including failed runs and normal signal-based interruption. Production builds preserve runnable output while discarding only their rebuildable cache. After stopping local processes, all generated web caches can also be cleared manually with `pnpm clean:web-cache`.

`pnpm db:migrate` applies all checked-in migrations that have not yet run, both locally and during deployment. When intentionally creating a new migration from edits to the Prisma schema, use `pnpm db:migrate:dev`.

## Deployment manifest

All applications select either `base` or `base-sepolia` through `PRECOMMUNITY_NETWORK` and `NEXT_PUBLIC_PRECOMMUNITY_NETWORK`. Base uses the `PUBLIC_*` deployment variables; Base Sepolia uses their `*_TESTNET` counterparts. Production requires a complete, same-network escrow address, deployment block, PRE, USDC, initial owner and treasury manifest; partial overrides fail startup. The application supports only the currently pinned contract and has no release selector, legacy decoder, fallback contract or mixed-deployment indexing.

Base Sepolia is deliberately unconfigured while the new V1 `escrow` release is prepared. After deployment, copy the address, deployment block, immutable token addresses, owner and treasury from `.deployments/base-sepolia.escrow.json` into one atomic application release.

For local switching, keep mainnet and testnet settings in the root `.env` and change only `PRECOMMUNITY_NETWORK` and `NEXT_PUBLIC_PRECOMMUNITY_NETWORK`; the web configuration loads the same root file. `DATABASE_URL_TESTNET` should use a separate PostgreSQL schema and `REDIS_URL_TESTNET` a separate Redis database so projections and repeatable jobs cannot mix across networks. API and worker use `BASE_RPC_URL_TESTNET` and `SAFE_ADDRESS_TESTNET` on Base Sepolia; web uses `NEXT_PUBLIC_BASE_RPC_URL_TESTNET`.

Before the first local testnet run, migrate and seed its isolated schema with `pnpm db:setup:testnet`. Start all applications on Base Sepolia with `pnpm dev:testnet`, or return to Base mainnet with `pnpm dev:mainnet`.

The only application ABI is generated from the reviewed sibling artifact at `../escrow/artifacts/contracts/PREcommunityEscrowV1.sol/PREcommunityEscrowV1.json` and pinned in `packages/shared/abi/PREcommunityEscrowV1.json`:

```bash
pnpm abi:sync
```

The worker verifies the network, bytecode at the deployment block, immutable PRE/USDC/treasury addresses, deployment owner event, current owner, the 24-period settlement limit, monthly schedule version `1`, and the exact 7/60-day override limits before writing any projection. A new contract address creates a new indexer state key and starts from that manifest's deployment block.

Contract sources and deployment automation are maintained separately and are not included in this repository. The application never requests, stores, or logs a private key, seed phrase, or wallet secret.

The worker rebuilds the confirmed contract owner and goal-manager set from `OwnershipTransferred` and `GoalManagerUpdated`. The owner receives the effective `SUPER_ADMIN` role; goal managers receive the content and finance capabilities needed for their contract operations. Database role assignment cannot grant `SUPER_ADMIN`.

## Safe payout approvals

Payouts use an existing [Safe Wallet](https://app.safe.global/) on the selected network. Configure `SAFE_ADDRESS` and `SAFE_TRANSACTION_SERVICE_API_KEY` on the API and worker; the key must never use a `NEXT_PUBLIC_` variable. A custom Transaction Service can instead be selected with `SAFE_TRANSACTION_SERVICE_URL`.

The Admin screen verifies the Safe address, owners, approval threshold, Transaction Service, and current escrow owner on-chain. Before the one-time ownership transfer, confirm at least one direct goal manager. The current direct owner can then start the two-step ownership transfer to Safe. Admin detects the pending Safe owner and lets a Safe owner publish the exact `acceptOwnership()` transaction to the Safe approval queue; control changes only after the Safe threshold approves and executes it.

One-time close/cancel and monthly policy/graceful-stop calls can be sent only by the direct escrow owner or by the still-authorized goal manager that originally created that exact goal. Monthly emergency cancellation is owner-only and always uses a durable Safe intent/proposal with exact calldata, nonce, signer, Transaction Service status and audit history. Vested monthly beneficiary funds are releasable while the goal remains active. Treasury releases use `releaseCancelledFunds`; the removed `releaseSurplus` path is not supported.

Every owner of the configured Safe receives the effective `SUPER_ADMIN` role once Safe is the confirmed escrow owner. Owners create proposals in the portal, then collect approvals and execute them in Safe Wallet. The worker mirrors submitting, waiting, ready, executed, replaced, and failed states back into Admin. Safe intents and proposals are durable workflow records and are preserved while the chain projection is rebuilt.

`SUPER_ADMIN`, `CONTENT_ADMIN`, and `FINANCE_ADMIN` sessions see the Admin navigation item. During the pending Safe ownership-transfer step, signed-in owners of that Safe also retain the Admin link for the limited acceptance flow without receiving an administrator role. The Admin feature controls expose the current PRE Keyword Market state to administrator roles, while only `SUPER_ADMIN` can change it. The market is disabled by default. Disabling it hides every `/keyword-market` page, returns `404` from the market API, and pauses ads indexing, metric flushing, and retention jobs without deleting stored data.

## Monthly goals

A draft is either `ONE_TIME` (future deadline, no monthly policy) or `MONTHLY` (no deadline, explicit `PAYOUT_ALL` or `ROLL_OVER`). Monthly publication calls `createMonthlyGoal`; funding starts in the mined transaction block. By default the first period ends on the same calendar day of the next month at 00:00 UTC, while an administrator may choose a first boundary 7–60 days ahead. The chosen base day is preserved and clamped only in shorter months. The public goal model exposes active, stopping, settlement-due, closed and cancelled phases together with current-period carry, vested amounts, carry-out and lifetime contribution/entitlement/payout balances. The first period always uses the full target, and settlement updates accounting without transferring funds.

Anyone can prepare `POST /v1/public/goals/:slug/settlement-request`. It returns neutral `settleMonthlyGoal` calldata with at most 24 due periods; the browser wallet sends it and the API never holds a private key. Period history is paginated at `GET /v1/public/goals/:slug/periods`.

## Guarded escrow cutover

Use `PRECOMMUNITY_ESCROW_CUTOVER=1` with a complete final manifest. The deploy workflow stages the new environment without overwriting the active contract configuration, stops writers, verifies the retired contract has zero `accountedByToken` for PRE and USDC and no `GoalCreated` logs since its deployment block, verifies a PostgreSQL backup, checks database blockers, exports the old public ledger, applies the migration, resets only escrow-derived state, backfills the replacement contract and reconciles both tokens before activation.

The guarded reset refuses open goals, projected liabilities, proposed payouts, active Safe proposals or unsubmitted lifecycle/manager intents. It preserves community content, users, goal drafts, profile moderation and the independent audit trail. If failure occurs after the migration, services remain stopped so the verified backup can be restored deliberately.

After cutover, transfer ownership to Safe and synchronize confirmed goal managers before publishing new goals. Publication relies on confirmed on-chain authority rather than a separate environment switch. The retired contract remains visible on-chain but is never queried by the application.

## Goal metadata

Core data lives in `GoalCreated`: title, short description, deadline, recipient, PRE/USDC targets, goal ID, transaction, and block. Optional IPFS JSON uses this shape:

```json
{
  "schema": "precommunity.goal-metadata.v1",
  "category": "Infrastructure",
  "subproject": { "name": "Public nodes", "slug": "public-nodes" },
  "discussionUrl": "https://example.org/discussion",
  "documents": [{ "label": "Budget", "url": "https://example.org/budget" }]
}
```

Every field after `schema` is independently optional. The system-owned `General` subproject is used to organize otherwise ungrouped drafts in the Admin panel, but it is omitted from public metadata. A goal with no optional metadata can be published without an IPFS URI.

When optional details are present, the Admin panel generates canonical JSON. An administrator can pin that exact file externally and paste its `ipfs://` CID before preparing an authorized contract transaction. Invalid, unavailable, or absent IPFS data never hides core on-chain fields.

## Community membership and voting

Community pages are public to read. The forum keeps open discussion separate from formal proposals: creating or editing a topic or reply requires an SIWE session and at least `COMMUNITY_MIN_PRE` PRE, while authors can still soft-delete their own content after their balance changes. Topic pre-moderation is disabled by default and can be switched at runtime by a content moderator in Admin; enabling it affects only newly submitted topics.

Creating or editing a proposal, proposal comment, or vote uses the same current PRE membership check. Editing the community profile is different: it is a wallet-only `setProfile` or `clearProfile` transaction on `PREcommunityEscrowV1`, requires neither SIWE nor PRE, and becomes visible in the official UI after 12 confirmations and indexing.

Opening a vote records a confirmed Base block. Every vote uses the wallet's PRE balance at that historical block, preventing a balance from being moved through multiple wallets during one vote. Production `BASE_RPC_URL` must support historical `eth_call` for the configured PRE contract. No private key is used for these reads.

## Verification

```bash
pnpm lint
pnpm build
pnpm typecheck
pnpm test
```

The worker test suite validates every required ABI signature, always compares it with the pinned artifact and compares it with `../escrow` when that sibling checkout is available. Set `ESCROW_ARTIFACT_PATH` only to point the same comparison at a separately reviewed build output.

Base Sepolia is a test network. A mainnet deployment requires independent security review and a separate, verified manifest.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
