import { ExternalLink } from 'lucide-react';

export interface KeywordMarketCreativePreviewValue {
  headline: string;
  description: string;
  destinationUrl: string;
  displayDomain?: string;
}

function displayDomain(value: KeywordMarketCreativePreviewValue) {
  if (value.displayDomain) return value.displayDomain;
  try {
    return new URL(value.destinationUrl).hostname;
  } catch {
    return 'destination.example';
  }
}

export function KeywordMarketCreativePreview({
  creative,
  keyword,
  interactive = false,
  placeholders = false,
}: {
  creative: KeywordMarketCreativePreviewValue;
  keyword?: string;
  interactive?: boolean;
  placeholders?: boolean;
}) {
  const headline = creative.headline || (placeholders ? 'Your headline appears here' : '');
  const description =
    creative.description ||
    (placeholders ? 'A concise description helps searchers understand the offer.' : '');
  const content = (
    <>
      <div className="keyword-market-preview-meta">
        <span>Sponsored</span>
        <span>{displayDomain(creative)}</span>
        {keyword ? <span className="keyword-market-keyword-chip">{keyword}</span> : null}
      </div>
      {headline ? <h3>{headline}</h3> : null}
      {description ? <p>{description}</p> : null}
    </>
  );

  if (interactive && creative.destinationUrl) {
    return (
      <a
        className="keyword-market-creative-preview group"
        href={creative.destinationUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {content}
        <ExternalLink className="keyword-market-preview-link" size={16} aria-hidden="true" />
      </a>
    );
  }
  return <div className="keyword-market-creative-preview">{content}</div>;
}
