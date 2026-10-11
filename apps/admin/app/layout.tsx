import './globals.css';
import type { Metadata } from 'next';
import Shell from './shell';

export const metadata: Metadata = { title: 'Good Deeds Admin', description: 'Content governance, verification review and operations' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
