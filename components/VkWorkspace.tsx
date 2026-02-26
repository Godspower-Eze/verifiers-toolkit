'use client';

import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import type { ValidatedVk } from '@/lib/vk/types';
import type { GeneratedVerifier } from '@/lib/verifier/types';
import VkPanel from './VkPanel';
import styles from './EditorWorkspace.module.css';
import { useStarknetWalletContext } from '@/components/StarknetWalletProvider';
import { getChainName } from '@/lib/starknet/constants';
import { useStarknetDeploy } from '@/hooks/useStarknetDeploy';
import DeploymentLogs from './DeploymentLogs';
import ScarbProjectViewer from './ScarbProjectViewer';

type GenerateState = 'idle' | 'generating' | 'success' | 'error';

export default function VkWorkspace() {
  const { wallet, account, address, chainId, isConnected, connectWallet, disconnectWallet } = useStarknetWalletContext();

  // ── Layout State
  const col1WRef = useRef(350);
  const outH2Ref = useRef(150);
  const outH1Ref = useRef(200);

  const [col1Width, _setCol1Width] = useState(350);
  const [outputHeight1, _setOutputHeight1] = useState(200);
  const [outputHeight2, _setOutputHeight2] = useState(150);

  const setCol1Width = useCallback((v: number) => { col1WRef.current = v; _setCol1Width(v); }, []);
  const setOut1 = useCallback((v: number) => { outH1Ref.current = v; _setOutputHeight1(v); }, []);
  const setOut2 = useCallback((v: number) => { outH2Ref.current = v; _setOutputHeight2(v); }, []);

  // ── Drag Handlers
  const startDrag = useCallback((e: React.MouseEvent, type: 'h' | 'v', onMove: (d: number) => void) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const handleMove = (ev: MouseEvent) => {
      if (type === 'h') onMove(ev.clientX - startX);
      else onMove(ev.clientY - startY);
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, []);

  const dragCol1Divider = useCallback((e: React.MouseEvent) => {
    const startW = col1WRef.current;
    startDrag(e, 'h', (dx) => setCol1Width(Math.max(250, Math.min(800, startW + dx))));
  }, [setCol1Width, startDrag]);

  const dragRow1Divider = useCallback((e: React.MouseEvent) => {
    const startH = outH1Ref.current;
    startDrag(e, 'v', (dy) => setOut1(Math.max(60, Math.min(600, startH - dy))));
  }, [setOut1, startDrag]);

  const dragRow2Divider = useCallback((e: React.MouseEvent) => {
    const startH = outH2Ref.current;
    startDrag(e, 'v', (dy) => setOut2(Math.max(60, Math.min(600, startH - dy))));
  }, [setOut2, startDrag]);

  // ── Verifier State
  const [validVk, setValidVk] = useState<ValidatedVk | null>(null);
  const [generateState, setGenerateState] = useState<GenerateState>('idle');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [verifier, setVerifier] = useState<GeneratedVerifier | null>(null);

  // ── Deploy State
  const deployProjectId = 'custom_vk_verifier';
  const {
    logs,
    isDeclaring,
    isDeploying,
    deployClassHash,
    contractAddress,
    isAlreadyDeclared,
    isCheckingDeclaration,
    handleCompileAndDeclare,
    handleDeploy,
    resetDeployState
  } = useStarknetDeploy(deployProjectId, { wallet, account, address, chainId });

  // ── Generate Handler
  const handleGenerate = useCallback(async () => {
    if (!validVk) return;
    setGenerateState('generating');
    setGenerateError(null);
    setVerifier(null);
    resetDeployState(); // Reset any past deployment cache so new verifiers must be compiled
    try {
      const resp = await fetch('/api/verifier/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vk: validVk }),
      });
      const data = await resp.json() as
        | { success: true; verifier: GeneratedVerifier }
        | { success: false; error: string };
      if (data.success) {
        setGenerateState('success');
        setVerifier(data.verifier);
      } else {
        setGenerateState('error');
        setGenerateError(data.error);
      }
    } catch (err) {
      setGenerateState('error');
      setGenerateError(String(err));
    }
  }, [validVk]);

  // ── Render
  return (
    <div className={styles.workspace}>

      <div className={styles.editorRow}>
        {/* ── Col 1: VK Panel + Generate Output ── */}
        <div className={styles.colWrap} style={{ width: col1Width, flexShrink: 0, minHeight: 0, minWidth: 0 }}>
          <div className={styles.paneLabelSmall}><span>Verification Key</span></div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0, minWidth: 0 }}>
            <VkPanel
              onValidVk={(vk) => { setValidVk(vk); setGenerateState('idle'); setVerifier(null); }}
              onClearVk={() => { setValidVk(null); setVerifier(null); setGenerateState('idle'); }}
            />
          </div>

          <div className={styles.rowDivider} onMouseDown={dragRow1Divider} />

          <div className={styles.outputPanel} style={{ height: outputHeight1, minHeight: 0, minWidth: 0 }}>
            <div className={styles.paneLabelSmall}>
              <span>Generator</span>
              {validVk && (
                <button
                  id="generate-btn"
                  className={`${styles.generateBtn} ${styles.btnSm} ${generateState === 'generating' ? styles.generating : ''}`}
                  onClick={handleGenerate}
                  disabled={generateState === 'generating'}
                >
                  {generateState === 'generating'
                    ? <><span className={styles.spinner} /> Generating…</>
                    : '⬡ Generate Verifier'}
                </button>
              )}
            </div>
            <div className={`${styles.outputContent} ${generateState === 'success' ? styles.hideOnMobile : ''}`}>
              {generateState === 'idle' && !validVk && <p className={styles.outputHint}>Upload a BN254 VK above to start.</p>}
              {generateState === 'idle' && validVk && <p className={styles.outputHint}>VK validated ✓ — click ⬡ Generate.</p>}
              {generateState === 'generating' && <p className={styles.outputHint}><span className={styles.spinner} /> Generating Cairo verifier…</p>}
              {generateState === 'error' && (
                <div className={styles.errorList}>
                  <div className={styles.errorHeader}>✗ Generation failed</div>
                  <div className={styles.errorItem}><span className={styles.errorMessage}>{generateError}</span></div>
                </div>
              )}
              {generateState === 'success' && verifier && (
                <div className={`${styles.successBlock} ${styles.hideOnMobile}`}>
                  <div className={styles.successHeader}>✓ Verifier generated successfully</div>
                  <table className={styles.statsTable}><tbody>
                    <tr><td>Project</td><td><strong>{verifier.projectName}</strong></td></tr>
                  </tbody></table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.colDivider} onMouseDown={dragCol1Divider} />

        {/* ── Col 2: Scarb Project Viewer + Deploy ── */}
        <div className={`${styles.colWrap} ${styles.cairoPane} ${!verifier ? styles.hideOnMobileEmpty : ''}`} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, minWidth: 0 }}>
            <ScarbProjectViewer 
              verifier={verifier} 
              generateState={generateState} 
              generateError={generateError}
              emptyMessage="Upload a VK, then click ⬡ Generate to see the Cairo verifier here."
            />
          </div>

          {verifier && (
            <div className={styles.deployFooterWrap}>
              {/* Deploy bar */}
              <div className={styles.deployBar}>
                {isConnected ? (
                  <>
                    <span className={styles.deployLabel} title={address || ''}>
                      {getChainName(chainId)} · {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connected'}
                    </span>
                    <button
                      id="declare-btn"
                      className={styles.declareBtn}
                      onClick={() => handleCompileAndDeclare(verifier)}
                      disabled={isDeclaring || isAlreadyDeclared || isCheckingDeclaration}
                    >
                      {isCheckingDeclaration ? 'Checking status...' : isDeclaring && !isAlreadyDeclared ? 'Compiling & Declaring...' : isAlreadyDeclared ? 'Declared ✓' : 'Compile & Declare'}
                    </button>
                    <button
                      id="deploy-btn"
                      className={styles.deployBtn}
                      onClick={handleDeploy}
                      disabled={isDeploying || !deployClassHash || !isAlreadyDeclared || isCheckingDeclaration}
                    >
                      {isDeploying ? 'Deploying...' : contractAddress ? 'Deploy Again' : 'Deploy'}
                    </button>
                    <button onClick={disconnectWallet} className={styles.disconnectBtn} disabled={isDeclaring || isDeploying}>Disconnect</button>
                  </>
                ) : (
                  <>
                    <span className={styles.deployLabel}>Deploy to Starknet</span>
                    <button onClick={connectWallet} className={styles.connectWalletBtn} title="Connect to Declare/Deploy">
                      Connect Wallet
                    </button>
                  </>
                )}
              </div>

              {/* Deployment logs — just above lower menu */}
              <div className={styles.rowDivider} onMouseDown={dragRow2Divider} />
              <div className={styles.outputPanel} style={{ height: outputHeight2, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
                <div className={styles.paneLabelSmall}><span>Deployment Logs</span></div>
                <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
                  <DeploymentLogs logs={logs} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
