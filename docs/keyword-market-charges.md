# Keyword Market click settlement

**Admin → Keyword Marketplace → Charges** shows pending debt, operator readiness and durable charge history. Automatic settlement defaults to **off**. Its editable defaults are **10 minutes from the oldest pending click OR 50 pending clicks**, counted separately for each network, contract, keyword, staker and position version. **Charge now** settles pending groups without these thresholds. SUPER_ADMIN may change settings or run settlement; content and finance administrators may inspect it.

The panel also shows lifetime **Billable clicks** and **Non-billable: 5-minute limit** totals for the selected network and contract, with their **Since** timestamp. They count the first click of each valid delivery link recorded as billable or suppressed by the campaign/IP window; opening the same link again does not add either total. Billable clicks include positive PRE debt and `PRICE_PENDING` USD debt awaiting a price or settlement, rather than confirming collected payments. Counting begins with the first newly captured billable or suppressed click after this release; older analytics and billing records are not backfilled. These totals survive charge settlement and cleanup of suppressed click records.

The operator must apply migration `20261013170000_ad_billing_click_totals` to the selected database before activating the updated API release, using its matching generated database client. Repository changes do not apply this migration or activate services.

## Click capture

Each authorized resolver delivery gets a distinct v2 signed click URL, including cache hits. The signature is bound to the creative, original stake version and issuance time, and uses the independent `ADS_DELIVERY_SECRET`. Tokens remain billable for one hour from issuance; times over sixty seconds ahead of the API clock are rejected. Expired, invalid, v1 and legacy revision-only links still redirect without creating new billing debt. HEAD/prefetch/prerender requests remain nonbilling. A delivery ID is claimed in PostgreSQL before reading the bid or quote, so repeating or concurrently opening its link cannot create a second bill or reprice its first click. Existing analytics keep their previous counting behavior and are not backfilled into debt.

Only one click per campaign and client IP is billable in a rolling five-minute window, including links from different deliveries or creative revisions. PostgreSQL stores an HMAC fingerprint made with the independent `ADS_CLICK_FINGERPRINT_SECRET` and the window expiry time, never the raw IP or user agent. A suppressed click still redirects and retains the existing click analytics; it creates no new billing debt. Clients sharing an IP share the window, and changing IP can bypass this guard.

At the first accepted billable click the API reads the current bid from `stakeDetailsOf` and the stored contract PRE/USD quote at one latest block, with a two-second deadline. The URL's issuance does not freeze its bid or quote. An RPC failure can use the synchronized database projection if its checkpoint is no older than sixty seconds. A definite empty or reopened stake never falls back to an older version. Withdrawal-pending positions may still pay for previously delivered ads.

A positive stored PRE/USD quotation fixes the click's raw PRE amount and quotation provenance permanently, including when the quote is old. With bid `B` in micro USD and USD/PRE quotation `Q` scaled to eighteen decimals, the amount is `floor(B * 10^30 / Q)`. There are no floating-point calculations and fractions below a PRE wei are rounded down. If the contract quote is missing, the redirect still works and the USD amount waits in `PRICE_PENDING`; the next routine with a positive stored contract quote converts it once. Delivery-token expiry and later price changes never invalidate or reprice debt already recorded in PRE.

Bid-capture failure or an unavailable client IP redirects without charging and records an unbilled error. Interrupted captures become unbilled after five minutes; they never substitute a later bid. If PostgreSQL is unavailable the API cannot record the click, so it logs a sanitized capture failure and preserves the redirect.

## Transaction recovery

The deployment-specific charge queue checks every fifteen seconds. Automatic off disables new automatic submissions, while conversion, receipt reconciliation and manual runs remain available. Click reservations and immutable charge batches are stored independently of the disposable chain projection. One contract call bills the combined PRE debt of one position; different positions require separate transactions.

The worker verifies the configured chain/contract, synchronized projection, operator authorization and ETH funding before signing. Pending withdrawals and a paused contract do not by themselves block `chargeStake`. A durable wallet nonce reservation and signed transaction hash/bytes are saved before broadcasting. Retrying a broadcast uses the same transaction and charge ID; ambiguous outcomes are reconciled rather than recreated as another bill.

`StakeCharged` confirms the requested and actual PRE amounts after the application's confirmation boundary. Partial charges exhaust the original position and record the shortfall as uncollectable. Closed-position debt never transfers to a reopened stake. Reorganizations retain billing records and reconcile the original charge ID. A prepared batch whose original bid proof was removed stays blocked for review; other batches may proceed. A missing earlier wallet nonce requires operator intervention. Stuck transactions remain visible; this release does not automatically replace gas fees.

## Operator configuration

Place the Ethereum JSON keystore outside release directories and configure the environment used by the worker:

```dotenv
ADS_OPERATOR_KEYSTORE_PATH=/etc/precommunity/.keystore-operator.json
ADS_OPERATOR_KEYSTORE_PASSWORD='the exact operator password'
ADS_OPERATOR_KEYSTORE_PATH_TESTNET=/etc/precommunity/.keystore-operator-testnet.json
ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET='the exact testnet operator password'
```

Relative keystore paths start at the repository root. Base uses the unsuffixed pair; Base Sepolia uses only `_TESTNET`. Password whitespace is significant. Generated environments may use `ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64[_TESTNET]` to preserve characters exactly; base64 is an encoding, not encryption, and that value is equally private. An explicit raw password takes precedence. Credentials and signed transaction bytes are omitted from public API records and logs.

The signing address must be registered through the contract owner's Safe `setOperator(address)` and hold ETH for gas, including Base L1 data and operator fees. A missing/unreadable keystore, incorrect password or revoked operator blocks settlement without stopping price collection or indexing. Files named `.keystore*` are ignored by Git and excluded from release transfers; keep other keystore names outside the repository.

Runtime regeneration preserves both network pairs. VPS deployment transfers a configured replacement for the selected network over protected standard input, after any Safe and CoinGecko keys; it never copies the keystore file or includes its password in SSH arguments. An absent local pair preserves the existing server pair. The configured path must exist on the destination host. Rehearsal profile generation preserves its explicit testnet pair or copies the parent's explicit testnet pair, without inheriting a mainnet signer.

## API and rollout

All endpoints under `/v1/admin/keyword-market/charges` require an admin session and return `no-store` responses:

| Method and suffix | Result                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /`           | Settings, worker state, pending PRE/USD, latest run and twenty recent batches; `cursor` loads older batches |
| `PATCH /settings` | `{ automaticEnabled, intervalMinutes, clickThreshold }`, positive integers and an audited update            |
| `POST /run`       | `202 { jobId }`, coalescing outstanding manual runs                                                         |
| `GET /run/:jobId` | Persisted run status and safe batch results                                                                 |

Apply migration `20261011120000_ad_click_charges` to the intended database and run the updated applications using the normal operator-managed workflow. Provision the keystore, authorize its address through the Safe and fund ETH. Verify a manual testnet charge and its confirmation/history, then enable automatic settlement in admin. No historical analytics are billed. Agent implementation does not start services, apply live migrations or send blockchain transactions.

For the delivery v2 rollout, prepare the new database client and click-protection migration, and generate/persist both new API secrets before activating the release. `ops/configure-app-runtime.sh` backfills older `app.secrets` files without rotating the session or report secrets; subsequent configuration preserves all four keys. Rehearsal profiles receive separate stable secrets. Every API replica must use the same deployment secrets and version: coordinate the switch before returning traffic, because an old replica still accepts v1 billing and cannot bill a new v2 link. After the switch, previously issued v1 links remain usable redirects without new debt. Previously captured billing records continue through settlement unchanged. Database migration and service activation remain operator actions.
