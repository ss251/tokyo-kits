import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'ENS Configuration Lab · Tokyo Kits', description: 'Read ENSv2 configuration through the official Sepolia Universal Resolver and compare it with literal application settings.' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
