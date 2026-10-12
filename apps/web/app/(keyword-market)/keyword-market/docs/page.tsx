import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'API docs' };

const resolveExample = `curl --get 'https://precommunity.org/api/v1/keyword-market/resolve' \\
  --data-urlencode 'q=bitcoin' \\
  --header "X-API-Key: $KEYWORD_MARKET_API_KEY"`;

const adResponse = `{
  "ad": {
    "headline": "Explore Bitcoin",
    "description": "Learn more about Bitcoin.",
    "clickUrl": "https://precommunity.org/api/v1/keyword-market/revisions/00000000-0000-4000-8000-000000000001/click",
    "url": "https://example.com/bitcoin",
    "reportUrl": "https://precommunity.org/keyword-market/reports/00000000-0000-4000-8000-000000000001"
  }
}`;

export default function KeywordMarketDocsPage() {
  return (
    <main className="keyword-market-app-shell">
      <div className="max-w-4xl">
        <header className="keyword-market-page-heading keyword-market-page-heading-compact">
          <div>
            <span className="keyword-market-eyebrow">Search engine integrations</span>
            <h1>API docs.</h1>
            <p>
              Resolve a search query into one eligible text ad, then link through its click URL.
            </p>
          </div>
        </header>

        <section className="py-8" aria-labelledby="docs-quickstart">
          <header className="keyword-market-section-heading">
            <h2 id="docs-quickstart">Quick start</h2>
          </header>
          <p className="mb-4 leading-relaxed text-muted">
            Ask a SUPER_ADMIN for a named integration key from the API keys tab. Set it as{' '}
            <code>KEYWORD_MARKET_API_KEY</code> on your server and send it in the{' '}
            <code>X-API-Key</code> header. Keep the key out of browsers, URLs and logs.
          </p>
          <pre className="overflow-x-auto border border-line bg-surface p-5 text-xs leading-relaxed">
            <code>{resolveExample}</code>
          </pre>
          <p className="mt-3 text-sm text-muted">
            This example uses the production origin. For another environment, replace the origin and
            keep <code>/api/v1/keyword-market</code>. The <code>q</code> parameter is required: up
            to 256 characters and 32 word tokens.
          </p>
        </section>

        <section className="keyword-market-detail-section" aria-labelledby="docs-response">
          <header className="keyword-market-section-heading">
            <h2 id="docs-response">Use the response</h2>
          </header>
          <p className="mb-4 leading-relaxed text-muted">
            A successful request returns <code>ad</code> with only the fields needed to display it.
          </p>
          <pre className="overflow-x-auto border border-line bg-surface p-5 text-xs leading-relaxed">
            <code>{adResponse}</code>
          </pre>
          <p className="mt-4 leading-relaxed text-muted">
            Render <code>headline</code> and <code>description</code>, and use <code>clickUrl</code>{' '}
            exactly as returned, including its query parameters, as the link. It records the click
            and redirects to <code>url</code>, the full HTTPS destination address. Request a new
            resolver response for each ad delivery so each viewer receives their own click link.
          </p>
          <p className="mt-3 leading-relaxed text-muted">
            Use <code>reportUrl</code> for a Report ad link. It opens a public form on Precommunity;
            no login is required. Opening the link does not save a report. The user selects a
            reason, can add a comment of up to 500 characters, then submits it for Moderation.
          </p>
          <p className="mt-3 leading-relaxed text-muted">
            If the response is <code>{'{ "ad": null }'}</code>, show no ad. This can also happen
            while the market is syncing.
          </p>
          <p className="mt-3 leading-relaxed text-muted">
            Matching uses whole words, prefers the longest eligible phrase, then the highest USD
            bid. Each regular GET delivery containing an ad counts as a View. Responses are{' '}
            <code>no-store</code>; do not cache them in your integration.
          </p>
        </section>

        <section className="keyword-market-detail-section" aria-labelledby="docs-endpoints">
          <header className="keyword-market-section-heading">
            <h2 id="docs-endpoints">Endpoints</h2>
          </header>
          <p className="mb-4 break-all text-sm text-muted">
            Base URL: <code>https://precommunity.org/api/v1/keyword-market</code>
          </p>
          <dl className="divide-y divide-line">
            <div className="py-3">
              <dt className="break-all font-mono text-xs">GET /resolve?q=bitcoin</dt>
              <dd className="mt-1 text-muted">One matching ad or null. Requires X-API-Key.</dd>
            </div>
            <div className="py-3">
              <dt className="break-all font-mono text-xs">GET /revisions/:revisionId/click</dt>
              <dd className="mt-1 text-muted">302 redirect. Use the returned clickUrl. No key.</dd>
            </div>
            <div className="py-3">
              <dt className="break-all font-mono text-xs">POST /revisions/:revisionId/reports</dt>
              <dd className="mt-1 text-muted">
                Anonymous report submission from the reportUrl form. Rate limited; returns 202.
              </dd>
            </div>
            <div className="py-3">
              <dt className="break-all font-mono text-xs">GET /keywords/:keyword</dt>
              <dd className="mt-1 text-muted">
                Public stake ranking for an exact keyword. No key; does not count Views.
              </dd>
            </div>
            <div className="py-3">
              <dt className="break-all font-mono text-xs">GET /status</dt>
              <dd className="mt-1 text-muted">Chain and indexer readiness. No key.</dd>
            </div>
          </dl>
        </section>

        <section className="keyword-market-detail-section" aria-labelledby="docs-errors">
          <header className="keyword-market-section-heading">
            <h2 id="docs-errors">Errors</h2>
          </header>
          <ul className="space-y-2 text-muted">
            <li>
              <code>400</code> — Missing or invalid query.
            </li>
            <li>
              <code>401</code> — Missing, invalid or revoked API key.
            </li>
            <li>
              <code>404</code> — Market disabled or click revision unavailable.
            </li>
            <li>
              <code>503</code> — Service temporarily unavailable; retry later.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
