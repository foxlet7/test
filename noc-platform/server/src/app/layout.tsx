import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'NOC Platform', description: 'Network monitoring, NOC wall and circuit cost tracking' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Brand face; the UI falls back to Segoe UI / system fonts when offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Titillium+Web:wght@300;400;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
