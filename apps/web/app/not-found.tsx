import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page-gutter flex min-h-[60vh] flex-col justify-center py-[60px]">
      <span className="hidden">404</span>
      <h1 className="m-0 text-4xl">Page not found</h1>
      <p className="text-muted">Check the URL and try again.</p>
      <Link className="w-max text-blue" href="/">
        Back to precommunity
      </Link>
    </main>
  );
}
