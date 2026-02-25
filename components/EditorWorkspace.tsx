'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as MonacoNS from 'monaco-editor';
import type { CircuitTemplate } from '@/lib/circom/circuitTemplates';
import type { CompileError, CompileResponse } from '@/lib/circom/types';
import type { GeneratedVerifier } from '@/lib/verifier/types';
import styles from './EditorWorkspace.module.css';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { useStarknetDeploy } from '@/hooks/useStarknetDeploy';
import { getChainName } from '@/lib/starknet/constants';
import DeploymentLogs from './DeploymentLogs';
import ScarbProjectViewer from './ScarbProjectViewer';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type CompileState = 'idle' | 'compiling' | 'success' | 'error';
type GenerateState = 'idle' | 'generating' | 'success' | 'error';
type ActiveFile = 'Scarb.toml' | 'lib.cairo' | 'groth16_verifier.cairo' | 'groth16_verifier_constants.cairo';

// ─── Drag utility ────────────────────────────────────────────────────────────

/** Starts a drag session. Calls onMove(delta) on every mouse move until mouseup. */
function startDrag(
  e: React.MouseEvent,
  axis: 'h' | 'v',
  onMove: (delta: number) => void,
) {
  e.preventDefault();
  const startPos = axis === 'h' ? e.clientX : e.clientY;
  document.body.style.cursor = axis === 'h' ? 'col-resize' : 'row-resize';
  document.body.style.userSelect = 'none';
  const move = (ev: MouseEvent) => onMove((axis === 'h' ? ev.clientX : ev.clientY) - startPos);
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditorWorkspace() {
  const { account, address, wallet, chainId, isConnected, connectWallet, disconnectWallet } = useStarknetWallet();
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);

  // ── Sizes — stored in refs for getValue() snapshots, synced to state for renders
  const col1WRef = useRef(420);
  const outH1Ref = useRef(180);
  const outH2Ref = useRef(150);

  const [col1Width, _setCol1Width] = useState(420);
  const [outputHeight1, _setOutputHeight1] = useState(180);
  const [outputHeight2, _setOutputHeight2] = useState(150);

  // Setters that keep refs in sync
  const setCol1Width = useCallback((v: number) => { col1WRef.current = v; _setCol1Width(v); }, []);
  const setOut1 = useCallback((v: number) => { outH1Ref.current = v; _setOutputHeight1(v); }, []);
  const setOut2 = useCallback((v: number) => { outH2Ref.current = v; _setOutputHeight2(v); }, []);

  // ── Circuit state
  const [templates, setTemplates] = useState<CircuitTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [code, setCode] = useState('');
  const [filename, setFilename] = useState('circuit.circom');
  const [compileState, setCompileState] = useState<CompileState>('idle');
  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null);

  // ── Verifier state
  const [generateState, setGenerateState] = useState<GenerateState>('idle');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [verifier, setVerifier] = useState<GeneratedVerifier | null>(null);

  // ── Deploy Hook (scoped to circuit filename so it persists between reloads)
  const deployProjectId = filename.replace('.circom', '');
  const {
    logs,
    isDeclaring,
    isDeploying,
    deployClassHash,
    contractAddress,
    isAlreadyDeclared,
    handleCompileAndDeclare,
    handleDeploy
  } = useStarknetDeploy(deployProjectId, { wallet, account, address, chainId });

  // ── Templates
  useEffect(() => {
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data: CircuitTemplate[]) => {
        setTemplates(data);
        if (data.length > 0) applyTemplate(data[0]);
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTemplate = useCallback((t: CircuitTemplate) => {
    setSelectedId(t.id);
    setCode(t.code);
    setFilename(t.filename);
    setCompileResult(null);
    setCompileState('idle');
    clearEditorMarkers();
  }, []);

  // ── Monaco reflow: after DOM updates, trigger layout via requestAnimationFrame
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => { editorRef.current?.layout(); });
    return () => cancelAnimationFrame(raf);
  }, [col1Width]);

  // ── Compile
  const handleCompile = useCallback(async () => {
    setCompileState('compiling');
    setCompileResult(null);
    clearEditorMarkers();
    try {
      const resp = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: code, filename, language: 'circom' }),
      });
      const result: CompileResponse = await resp.json();
      setCompileResult(result);
      setCompileState(result.success ? 'success' : 'error');
      if (!result.success) applyEditorMarkers(result.errors);
    } catch (err) {
      console.error('Compile failed:', err);
      setCompileState('error');
    }
  }, [code, filename]);




  // ── Markers
  function clearEditorMarkers() {
    if (!editorRef.current || !monacoRef.current) return;
    monacoRef.current.editor.setModelMarkers(editorRef.current.getModel()!, 'circom-compiler', []);
  }
  function applyEditorMarkers(errors: CompileError[]) {
    if (!editorRef.current || !monacoRef.current) return;
    const m = monacoRef.current;
    const markers: MonacoNS.editor.IMarkerData[] = errors.map((e) => ({
      severity: m.MarkerSeverity.Error,
      message: e.message,
      startLineNumber: e.line ?? 1,
      startColumn: e.column ?? 1,
      endLineNumber: e.line ?? 1,
      endColumn: (e.column ?? 1) + 10,
    }));
    m.editor.setModelMarkers(editorRef.current.getModel()!, 'circom-compiler', markers);
  }

  // ── Drag handlers — each captures startPos + startVal at mousedown ──────────

  // Col1 divider (right of col1): drag right → col1 wider
  const dragCol1Divider = useCallback((e: React.MouseEvent) => {
    const startW = col1WRef.current;
    startDrag(e, 'h', (dx) => setCol1Width(Math.max(220, Math.min(900, startW + dx))));
  }, [setCol1Width]);

  // Row1 divider (above compile output in col1): drag down → output panel smaller
  const dragRow1Divider = useCallback((e: React.MouseEvent) => {
    const startH = outH1Ref.current;
    startDrag(e, 'v', (dy) => setOut1(Math.max(60, Math.min(600, startH - dy))));
  }, [setOut1]);

  // Row2 divider (above deployment logs in col2): drag down → logs panel smaller
  const dragRow2Divider = useCallback((e: React.MouseEvent) => {
    const startH = outH2Ref.current;
    startDrag(e, 'v', (dy) => setOut2(Math.max(60, Math.min(600, startH - dy))));
  }, [setOut2]);




  // ── Render
  return (
    <div className={styles.workspace}>

      {/* Resizable 2-column row */}
      <div className={styles.editorRow}>

        {/* ── Col 1: Circom editor (top) + compile output (bottom) ── */}
        <div className={styles.colWrap} style={{ width: col1Width, flexShrink: 0 }}>
          {/* Pane label: file language switcher + template picker */}
          <div className={styles.paneLabel}>
            <div className={styles.paneLabelLeft}>
              <span>{filename}</span>
              <div className={styles.langSwitcher}>
                <span className={styles.langActive}>Circom 2.0</span>
                <span className={styles.langSoon} title="Coming soon">Noir</span>
              </div>
            </div>
            <div className={styles.templatePicker}>
              <label htmlFor="template-select" className={styles.label}>Template</label>
              <select
                id="template-select"
                className={styles.select}
                value={selectedId}
                onChange={(e) => {
                  const t = templates.find((t) => t.id === e.target.value);
                  if (t) applyTemplate(t);
                }}
              >
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          {/* Monaco fills remaining height */}
          <div className={styles.monacoWrap}>
            <MonacoEditor
              height="100%"
              defaultLanguage="rust"
              theme="vs-dark"
              value={code}
              onChange={(v) => setCode(v ?? '')}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                automaticLayout: true,
              }}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
              }}
            />
          </div>
          {/* Row drag handle → resize compile output */}
          <div className={styles.rowDivider} onMouseDown={dragRow1Divider} />
          {/* Compile output */}
          <div className={styles.outputPanel} style={{ height: outputHeight1 }}>
            <div className={styles.paneLabelSmall}>
              <span>Compile Output</span>
              <button
                id="compile-btn"
                className={`${styles.compileBtn} ${styles[compileState]} ${styles.btnSm}`}
                onClick={handleCompile}
                disabled={compileState === 'compiling'}
              >
                {compileState === 'compiling'
                  ? <><span className={styles.spinner} /> Compiling…</>
                  : '▶ Compile'}
              </button>
            </div>
            <div className={styles.outputContent}>
              {compileState === 'idle' && <p className={styles.outputHint}>Click ▶ Compile to run the circuit.</p>}
              {compileState === 'compiling' && <p className={styles.outputHint}>Compiling…</p>}
              {compileState === 'success' && compileResult?.success && (
                <div className={styles.successBlock}>
                  <div className={styles.successHeader}>✓ Compiled successfully</div>
                  <table className={styles.statsTable}><tbody>
                    <tr><td>Non-linear constraints</td><td><strong>{(compileResult.result as { constraintCount: number }).constraintCount}</strong></td></tr>
                    {(compileResult.result as { wireCount?: number }).wireCount !== undefined && (
                      <tr><td>Wires</td><td><strong>{(compileResult.result as { wireCount?: number }).wireCount}</strong></td></tr>
                    )}
                  </tbody></table>
                  {(compileResult.result as { warnings: string[] }).warnings.length > 0 && (
                    <div className={styles.warningsList}><strong>Warnings:</strong><ul>
                      {(compileResult.result as { warnings: string[] }).warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul></div>
                  )}
                </div>
              )}
              {compileState === 'error' && compileResult && !compileResult.success && (
                <div className={styles.errorList}>
                  <div className={styles.errorHeader}>✗ Compilation failed</div>
                  {compileResult.errors.map((e, i) => (
                    <div key={i} className={styles.errorItem}>
                      <span className={styles.errorCategory}>{e.category}</span>
                      <span className={styles.errorMessage}>{e.message.replace(/\x1B\[[0-9;]*m/g, '')}</span>
                      {e.line && <span className={styles.errorLocation}>line {e.line}{e.column ? `:${e.column}` : ''}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Col divider: resize col1 ── */}
        <div className={styles.colDivider} onMouseDown={dragCol1Divider} />

        {/* ── Col 2: Cairo verifier — always rendered (flex:1 fills the space) ── */}
        <div className={`${styles.colWrap} ${styles.cairoPane}`} style={{ flex: 1, minWidth: 180, position: 'relative' }}>
          
          {/* Replace file tree and monaco editor with the extracted component */}
          <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0 }}>
            <ScarbProjectViewer 
              verifier={verifier} 
              generateState={generateState} 
              generateError={generateError}
              emptyMessage="Compile your circuit and generate a verifier to see the Cairo output here."
            />
          </div>

          {/* Row drag handle → resize logs panel — only when verifier exists */}
          {verifier && (
            <>
              <div className={styles.rowDivider} onMouseDown={dragRow2Divider} />
              <div className={styles.outputPanel} style={{ height: outputHeight2, display: 'flex', flexDirection: 'column' }}>
                <div className={styles.paneLabelSmall}><span>Deployment Logs</span></div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <DeploymentLogs logs={logs} />
                </div>
              </div>
            </>
          )}

          {/* Deploy bar — only when verifier exists */}
          {verifier && (
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
                    disabled={isDeclaring || isAlreadyDeclared}
                  >
                    {isDeclaring && !isAlreadyDeclared ? 'Compiling & Declaring...' : isAlreadyDeclared ? 'Declared ✓' : 'Compile & Declare'}
                  </button>
                  <button
                    id="deploy-btn"
                    className={styles.deployBtn}
                    onClick={handleDeploy}
                    disabled={isDeploying || !deployClassHash || !!contractAddress}
                  >
                    {isDeploying ? 'Deploying...' : contractAddress ? 'Deployed ✓' : 'Deploy'}
                  </button>
                  <button onClick={disconnectWallet} className={styles.disconnectBtn}>Disconnect</button>
                </>
              ) : (
                <>
                  <span className={styles.deployLabel}>Deploy to Starknet</span>
                  <button onClick={connectWallet} className={styles.connectWalletBtn}>Connect Wallet</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
