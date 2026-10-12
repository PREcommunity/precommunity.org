import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/components/providers';
import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';

const manrope = localFont({
  src: './fonts/manrope-variable.ttf',
  variable: '--font-manrope',
  weight: '200 800',
  display: 'swap',
});
const plexMono = localFont({
  src: './fonts/ibm-plex-mono-regular.ttf',
  variable: '--font-plex-mono',
  weight: '400',
  display: 'swap',
});

const siteUrl = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3011');
const siteTitle = 'PRE community';
const siteDescription =
  'The PRE Community is a public, community-funded effort to rebuild decentralized search - in the open, on a ledger anyone can audit.';

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: 'precommunity',
  manifest: '/manifest.webmanifest',
  title: { default: siteTitle, template: '%s · precommunity' },
  description: siteDescription,
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: './',
    siteName: 'precommunity',
    title: siteTitle,
    description: siteDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#2d8eff" />
        {/* Apply before first paint without waiting for the Next.js runtime. */}
        <script
          id="precommunity-theme-init"
          dangerouslySetInnerHTML={{
            __html: `(function(){var p='system';try{var s=localStorage.getItem('precommunity-theme');if(s==='light'||s==='dark'||s==='system')p=s}catch(e){}var d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d;document.querySelector('meta[name="theme-color"]').setAttribute('content',d==='dark'?'#07172a':'#2d8eff')})()`,
          }}
        />
      </head>
      <body className={`${manrope.variable} ${plexMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
