'use client';

import { useState, Suspense } from 'react';
import styles from './AppShell.module.css';
import EditorWorkspace from './EditorWorkspace';
import VkWorkspace from './VkWorkspace';
import VerifyWorkspace from './VerifyWorkspace';

type Tab = 'circuit' | 'vk' | 'verify';

const tabs: { id: Tab; icon: string; label: string }[] = [
  { id: 'circuit', icon: '⌨', label: 'Write Circuit' },
  { id: 'vk',      icon: '🔑', label: 'Upload VK' },
  { id: 'verify',  icon: '✓', label: 'Verify Proof' },
];

export default function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>('circuit');

  return (
    <div className={styles.shell}>
      {/* ── Sidebar ── */}
      <nav className={styles.sidebar}>
        <div className={styles.brand}>◆</div>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.navBtn} ${activeTab === tab.id ? styles.navBtnActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
            aria-label={tab.label}
          >
            <span>{tab.icon}</span>
            <span className={styles.tooltip}>{tab.label}</span>
          </button>
        ))}
        <div className={styles.spacer} />
        <span className={styles.brandTitle}>Cairo Verifiers Generator</span>
      </nav>

      {/* ── Content — header bar + panels ── */}
      <div className={styles.mainWrap}>
        <div className={styles.contentHeader}>
          <span className={styles.contentTitle}>
            {activeTab === 'circuit' && 'Write Circuit'}
            {activeTab === 'vk' && 'Upload Verification Key'}
            {activeTab === 'verify' && 'Verify Proof'}
          </span>
          <span className={styles.contentSubtitle}>
            {activeTab === 'circuit' && 'Circom / Noir → Groth16 Cairo Verifier · Powered by Garaga'}
            {activeTab === 'vk' && 'verification_key.json → Cairo Verifier'}
            {activeTab === 'verify' && 'proof.json + public.json → On-chain Verification'}
          </span>
        </div>
        <div className={styles.main}>
          <div className={`${styles.panel} ${activeTab === 'circuit' ? styles.panelActive : ''}`}>
            <Suspense fallback={<div style={{ padding: 32, color: '#64748b' }}>Loading editor…</div>}>
              <EditorWorkspace />
            </Suspense>
          </div>
          <div className={`${styles.panel} ${activeTab === 'vk' ? styles.panelActive : ''}`}>
            <VkWorkspace />
          </div>
          <div className={`${styles.panel} ${activeTab === 'verify' ? styles.panelActive : ''}`}>
            <VerifyWorkspace />
          </div>
        </div>
      </div>
    </div>
  );
}
