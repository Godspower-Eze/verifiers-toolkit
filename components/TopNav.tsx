'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { Loader2, Zap } from 'lucide-react';

export default function TopNav() {
  const pathname = usePathname();
  const { wallet, address, isConnecting, connectWallet, disconnectWallet } = useStarknetWallet();

  const navLinks = [
    { href: '/circuit', label: 'Write Circuit' },
    { href: '/vk', label: 'Upload VK' },
    { href: '/verify', label: 'Verify Proof' },
  ];

  return (
    <nav className="flex items-center justify-between border-b border-slate-800 bg-slate-900/50 px-6 py-3">
      {/* Brand & Links */}
      <div className="flex items-center space-x-8">
        <Link href="/" className="flex items-center space-x-2 text-indigo-400 hover:text-indigo-300 transition-colors">
          <Zap className="h-5 w-5" />
          <span className="font-semibold text-lg tracking-tight">Cairo Verifiers Toolkit</span>
        </Link>
        <div className="flex space-x-1">
          {navLinks.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-slate-800 text-slate-100 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Wallet Controls */}
      <div className="flex items-center">
        {isConnecting ? (
          <button
            disabled
            className="flex items-center space-x-2 rounded bg-indigo-500/50 px-4 py-2 text-sm font-medium text-white transition-colors cursor-not-allowed"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Connecting...</span>
          </button>
        ) : address ? (
          <div className="flex items-center space-x-3">
            <span className="text-sm font-mono text-slate-400 bg-slate-800 px-3 py-1.5 rounded-md border border-slate-700">
              {address.slice(0, 6)}...{address.slice(-4)}
            </span>
            <button
              onClick={disconnectWallet}
              className="rounded px-3 py-1.5 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={connectWallet}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
}
