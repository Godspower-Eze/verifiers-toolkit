'use client';

import { useState, Suspense, Fragment } from 'react';
import styles from './AppShell.module.css';
import EditorWorkspace, { type PipelineStage } from './EditorWorkspace';
import VkWorkspace from './VkWorkspace';
import VerifyWorkspace from './VerifyWorkspace';

type Tab = 'circuit' | 'vk' | 'verify';

const tabs: { id: Tab; icon: string; label: string }[] = [
  { id: 'circuit', icon: '⌨', label: 'Circuit' },
  { id: 'vk',      icon: '🔑', label: 'VK' },
  { id: 'verify',  icon: '✓', label: 'Verify' },
];

const circuitStages: { id: PipelineStage; icon: string; label: string }[] = [
  { id: 'editor', icon: '📝', label: 'Editor & Compile' },
  { id: 'setup', icon: '🔐', label: 'Setup' },
  { id: 'prove', icon: '⚡', label: 'Prove' },
];

export default function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>('circuit');
  const [activeCircuitStage, setActiveCircuitStage] = useState<PipelineStage>('editor');

  return (
    <div className={styles.shell}>
      {/* ── Sidebar ── */}
      <nav className={styles.sidebar}>
        <div className={styles.brand}>◆</div>
        {tabs.map((tab) => (
          <div key={tab.id} style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center' }}>
            <button
              className={`${styles.navBtn} ${activeTab === tab.id ? styles.navBtnActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
              aria-label={tab.label}
            >
              <span className={styles.navIcon}>{tab.icon}</span>
              <span className={styles.navLabel}>{tab.label}</span>
            </button>
            {tab.id === 'circuit' && activeTab === 'circuit' && (
              <div className={styles.subNavGroup}>
                {circuitStages.map(st => (
                  <button 
                    key={st.id}
                    className={`${styles.subnavBtn} ${activeCircuitStage === st.id ? styles.subnavBtnActive : ''}`}
                    onClick={() => setActiveCircuitStage(st.id)}
                    title={st.label}
                  >
                    <span className={styles.subnavIcon}>{st.icon}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className={styles.spacer} />
        <span className={styles.brandTitle}>Verifiers Generator</span>
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
              <EditorWorkspace 
                activeStage={activeCircuitStage} 
                setActiveStage={setActiveCircuitStage}
                onNavigateToVk={() => setActiveTab('vk')}
              />
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
