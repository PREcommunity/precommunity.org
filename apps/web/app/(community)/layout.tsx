import { BrandMark } from '@/components/brand-mark';
import { SiteHeader } from '@/components/site-header';

export default function CommunityLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen min-h-svh flex-col">
      <SiteHeader />
      {children}
      <footer className="site-footer">
        <span className="flex items-center gap-2 font-bold text-navy">
          <BrandMark className="size-6 max-sm:size-6" /> community
        </span>
        <span className="text-[11px]">Community decisions off-chain. Funding proof on Base.</span>
      </footer>
    </div>
  );
}
