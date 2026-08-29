# PRE Keyword Market operations and contract handoff

PRE Keyword Market runs at `/keyword-market` on the main application origin using the existing web, API, worker, PostgreSQL and Redis processes. It does not introduce a separate service. The phase-one adapter intentionally reports `AWAITING_CONTRACT`; stake, increase and unstake controls remain disabled until the reviewed contract handoff is implemented.

In the local MAMP Pro setup, the browser-facing address is `https://precommunity.test/keyword-market`. Port `3011` remains only the internal Next.js proxy target and is not part of the SIWE origin.

## Public surface

- `GET /v1/keyword-market/status` — chain adapter status and transaction availability.
- `GET /v1/keyword-market/resolve?q=...` — always returns `{ requestId, algorithmVersion, ad }` with `ad: null` when there is no eligible result.
- `GET /v1/keyword-market/keywords/:keyword` — public stake ranking and chain proof without competitor creative content.
- `POST /v1/keyword-market/revisions/:revisionId/reports` — anonymous report intake; callers receive the same generic `202` response.

The co-hosted web client reaches these endpoints through the existing `/api/v1/keyword-market/...` proxy prefix.

The resolver normalizes with Unicode NFKC, lowercases, treats punctuation as a separator and matches only whole-token phrases. Candidate priority is: most tokens, longest phrase, earliest occurrence, then lexical order. Within a keyword, active stake order is: greatest raw amount, earliest block/log at which that amount was reached, then staker address. A leader without an active approved creative is skipped before the resolver tries a shorter keyword.

Resolver responses and keyword rankings are `no-store`. Nginx applies a dedicated resolver limit and logs `$uri`, never the query string or raw client address. Successful selections increment best-effort Redis counters; the worker flushes idempotent batches into daily and lifetime PostgreSQL metrics. Counter failure cannot fail a resolve response.

## Authenticated and moderator surface

Advertiser endpoints require the SIWE session for the same wallet that owns the campaign. The market and community surfaces share one SIWE origin and one host-only `HttpOnly` session cookie with `Path=/`, so signing in or out applies to every application path without exposing the cookie to sibling subdomains.

- Advertisers can create one campaign per wallet and normalized keyword, submit immutable creative revisions, pause/resume, see ranking/proof, leader gap and 30-day/lifetime metrics.
- An approved creative remains active while an edited revision is pending. Approval switches the active revision; rejection leaves the previous version active.
- `CONTENT_ADMIN` and `SUPER_ADMIN` can filter revision and report queues, approve/reject/suspend/restore creatives, dismiss reports, or atomically suspend a creative and close its open reports. These actions use the existing audit log.
- Reports never suspend an ad automatically. PostgreSQL stores an HMAC fingerprint rather than a raw IP. Resolved report detail and daily metrics are retained for 12 months; lifetime aggregates and audit actions remain.

## Runtime configuration

Required additions:

```dotenv
ADS_REPORT_FINGERPRINT_SECRET=<independent random secret of at least 32 characters>
ADS_CONTRACT_ADDRESS=
ADS_CONTRACT_DEPLOYMENT_BLOCK=
```

`ops/configure-app-runtime.sh` creates and preserves the report HMAC secret independently from the session secret. Address and deployment block must either both be set or both remain empty. Merely setting them does not enable transactions: the adapter stays disabled until its ABI-specific implementation is reviewed.

## Routing and Nginx

No additional DNS record or TLS certificate is required. Run the existing Nginx configuration step for the canonical domain and verify that its HTTPS virtual host preserves the dedicated `/v1/keyword-market/resolve` and `/api/v1/keyword-market/resolve` locations, `precommunity_keyword_market_resolve` rate-limit zone and `precommunity_keyword_market` privacy-safe log format from the repository template.

If an `ads` DNS record or certificate name was prepared before this migration, remove it manually after the path-based release is verified.

## Contract handoff checklist

The adapter can be replaced only after all of the following are supplied and reviewed:

1. ABI and deployed contract address.
2. Chain ID and deployment block.
3. Exact keyword representation on-chain, including normalization or hashing rules.
4. Events for create, increase, unstake/withdraw and any position invalidation.
5. Transaction methods and argument encoding for create, increase and unstake.
6. Cooldown, withdrawal and cancellation rules.
7. Finality requirement and expected reorg behavior.

The implementation must then replace both `AwaitingContractAdsChainAdapter` in the API and `AwaitingContractAdsChainSource` in the worker, preserving idempotent event keys, amount tie timestamps, finalized indexing and the market-only projection reset.

## Release verification

Run Prisma validation/generation, lint, typecheck, unit tests and the production build. Apply the checked-in Prisma migration using the existing release workflow. Browser E2E requires the existing web/API/worker/PostgreSQL/Redis test services; do not start or manage them from the implementation workflow.
