export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex size-[42px] shrink-0 text-blue max-sm:size-9 ${className}`}
      aria-hidden="true"
    >
      <svg className="size-full overflow-visible" viewBox="0 0 48 48" focusable="false">
        <rect x="1" y="1" width="46" height="46" rx="13" fill="currentColor" />
        <g fill="#fff" transform="translate(-1 0)">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7 16.5h5.7c3.9 0 6.2 2.1 6.2 5.45s-2.3 5.45-6.2 5.45h-2v4.1H7v-15Zm3.7 3.25v4.4h1.8c1.75 0 2.65-.75 2.65-2.2s-.9-2.2-2.65-2.2h-1.8Z"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M19.3 16.5H25c3.9 0 6.2 2.05 6.2 5.3 0 2.2-1.05 3.85-2.95 4.7l3.45 5h-4.3l-2.8-4.25H23v4.25h-3.7v-15Zm3.7 3.25v4.3h1.8c1.75 0 2.65-.75 2.65-2.15s-.9-2.15-2.65-2.15H23Z"
          />
          <path d="M32.7 16.5H43v3.3h-6.7v2.5h6.25v3.2H36.3v2.7H43v3.3H32.7v-15Z" />
        </g>
      </svg>
    </span>
  );
}
