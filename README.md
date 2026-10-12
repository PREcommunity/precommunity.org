# precommunity

Community funding and governance for the Presearch ecosystem.

The app combines off-chain proposals and discussion with on-chain funding through `PREcommunityEscrowV1` on Base. Confirmed contract events are the source of truth for funding data; PostgreSQL stores community content and a rebuildable chain projection.

## Repository

- `apps/web` — Next.js frontend
- `apps/api` — NestJS API, SIWE sessions and access control
- `apps/worker` — chain indexer, reconciliation and Safe sync
- `packages/database` — Prisma schema and migrations
- `packages/shared` — deployment config, ABI and shared types
- `ops` — deployment and cutover scripts

## Requirements

- Node.js 22
- pnpm 11.22.0
- PostgreSQL
- Redis

## Local setup

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The web app runs at [localhost:3011](http://localhost:3011) and the API at `localhost:4000`.

Update `.env` with your PostgreSQL and Redis URLs. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to enable WalletConnect QR and mobile wallets.

### Local worker logs

The worker logs its startup network and contracts, queue readiness, job starts, completions, duration and errors. Indexing results include `status`, `processed` and `indexedThroughBlock`. `processed: 0` with `SYNCED` means the check succeeded without new events; `DISABLED`, `BLOCKED` and `WAITING_CONFIRMATION` describe the task's actual outcome even when it completed.

When starting the worker separately, capture its output in both the terminal and the ignored `logs/worker.log` file:

```bash
pnpm worker:logs
```

In another terminal, use `pnpm worker:logs:tail` to follow that file. The launcher uses the ordinary worker environment (`.env` and any shell overrides); it does not select the isolated rehearsal profile. Logs append across launches and have no automatic rotation. If a worker already runs separately or as part of `pnpm dev`, stop that instance yourself before using the launcher. The launcher does not start the API, website, PostgreSQL or Redis.

## Networks

Set both variables to the same network:

```dotenv
PRECOMMUNITY_NETWORK=base-sepolia
NEXT_PUBLIC_PRECOMMUNITY_NETWORK=base-sepolia
```

Supported values are `base` and `base-sepolia`.

- Base uses the `PUBLIC_*` deployment variables.
- Base Sepolia uses the corresponding `*_TESTNET` variables.
- Testnet should use a separate PostgreSQL schema and Redis database.

Initialize and run the testnet environment with:

```bash
pnpm db:setup:testnet
pnpm dev:testnet
```

Use `pnpm dev:mainnet` to run against Base mainnet.

Start the local Redis instance in a separate terminal using the installed MAMP binary:

```bash
pnpm redis:sepolia # 127.0.0.1:6382
pnpm redis:mainnet # 127.0.0.1:6379
```

Choose the command matching your Redis URL and leave that terminal open. These local instances do not persist Redis data to disk. If Redis already runs on the selected port, use the existing instance.

The escrow ABI is generated from the sibling `../escrow` checkout:

```bash
pnpm abi:sync
```

Contract source and deployment tooling live in that repository.

## Notes

- Public funding data is rebuilt from confirmed contract logs.
- The API never stores wallet private keys. Transactions are signed in the user's wallet or through Safe.
- Forum topics, proposals and comments are stored off-chain.
- Vote weight uses the PRE balance at the block where voting opened.
- PRE Keyword Market is disabled by default. See [docs/pre-keyword-market.md](docs/pre-keyword-market.md).
- Keyword Market click settlement uses an operator keystore and the admin **Charges** panel. Automatic charges default to off; see [docs/keyword-market-charges.md](docs/keyword-market-charges.md).

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm db:migrate:dev` when creating a migration and `pnpm clean:web-cache` to remove generated Next.js and Playwright caches.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
