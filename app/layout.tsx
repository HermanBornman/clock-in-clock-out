import type { Metadata } from 'next';
import './globals.css';
import './phase-one.css';
import './phase-two.css';
import './phase-three.css';

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
const vercelHostname = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
const siteUrl = configuredSiteUrl || (vercelHostname ? `https://${vercelHostname}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Presently — Staff attendance',
  description: 'Simple, reliable attendance for every store and every shift.',
  openGraph: {
    title: 'Presently — Staff attendance',
    description: 'Simple, reliable attendance for every store and every shift.',
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: 'Presently staff attendance application' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Presently — Staff attendance',
    description: 'Simple, reliable attendance for every store and every shift.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
