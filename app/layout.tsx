import type { Metadata } from 'next';
import './globals.css';
import './phase-one.css';
import './phase-two.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

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
