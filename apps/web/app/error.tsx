'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="page-gutter pt-7 pb-[60px]">
      <section className="my-7 flex min-h-[220px] flex-col items-center justify-center border-y border-line px-[18px] py-8 text-center">
        <span className="font-mono text-[11px] tracking-[.05em] text-blue uppercase">Error</span>
        <h1 className="mt-2.5 mb-1 text-2xl">Ledger unavailable</h1>
        <p className="text-muted">Couldn’t load the data.</p>
        <button
          className="cursor-pointer border border-navy bg-navy px-3 py-2 text-white"
          onClick={reset}
        >
          Retry
        </button>
      </section>
    </main>
  );
}
