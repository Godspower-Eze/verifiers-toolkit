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

      {/* ── Content — all panels stay mounted, only the active one is visible ── */}
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
  );
}
