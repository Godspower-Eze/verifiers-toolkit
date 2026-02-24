'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import styles from './TopNav.module.css';

export default function TopNav() {
  const pathname = usePathname();
  const { address, isConnecting, connectWallet, disconnectWallet } = useStarknetWallet();

  const navLinks = [
    { href: '/circuit', label: 'Write Circuit' },
    { href: '/vk', label: 'Upload VK' },
    { href: '/verify', label: 'Verify Proof' },
  ];

  return (
    <nav className={styles.nav}>
      {/* Brand & Links */}
      <div className={styles.brandGroup}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandIcon}>◆</span>
          <span>Cairo Verifiers Toolkit</span>
        </Link>
        <div className={styles.links}>
          {navLinks.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={isActive ? styles.navLinkActive : styles.navLink}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Wallet Controls */}
      <div className={styles.walletGroup}>
        {isConnecting ? (
          <button disabled className={styles.connectingBtn}>
            <span className={styles.spinner} />
            <span>Connecting…</span>
          </button>
        ) : address ? (
          <>
            <span className={styles.addressPill}>
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
            <button onClick={disconnectWallet} className={styles.disconnectBtn}>
              Disconnect
            </button>
          </>
        ) : (
          <button onClick={connectWallet} className={styles.connectBtn}>
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
}
