'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as MonacoNS from 'monaco-editor';
import type { CircuitTemplate } from '@/lib/circom/circuitTemplates';
import type { CompileError, CompileResponse } from '@/lib/circom/types';
import type { SnarkJsVk } from '@/lib/vk/types';
import type { GeneratedVerifier } from '@/lib/verifier/VerifierGenerator';
import VkPanel from './VkPanel';
import styles from './EditorWorkspace.module.css';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import DeploymentLogs, { LogEntry, LogType } from './DeploymentLogs';
import JSZip from 'jszip';

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
  const { account, address, isConnected, connectWallet, disconnectWallet } = useStarknetWallet();
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);

  // ── Sizes — stored in refs for getValue() snapshots, synced to state for renders
  const col1WRef = useRef(420);
  const col3WRef = useRef(300);
  const outH1Ref = useRef(180);
  const outH2Ref = useRef(150);
  const outH3Ref = useRef(200);

  const [col1Width, _setCol1Width] = useState(420);
  const [col3Width, _setCol3Width] = useState(300);
  const [outputHeight1, _setOutputHeight1] = useState(180);
  const [outputHeight2, _setOutputHeight2] = useState(150);
  const [outputHeight3, _setOutputHeight3] = useState(200);

  // Setters that keep refs in sync
  const setCol1Width = useCallback((v: number) => { col1WRef.current = v; _setCol1Width(v); }, []);
  const setCol3Width = useCallback((v: number) => { col3WRef.current = v; _setCol3Width(v); }, []);
  const setOut1 = useCallback((v: number) => { outH1Ref.current = v; _setOutputHeight1(v); }, []);
  const setOut2 = useCallback((v: number) => { outH2Ref.current = v; _setOutputHeight2(v); }, []);
  const setOut3 = useCallback((v: number) => { outH3Ref.current = v; _setOutputHeight3(v); }, []);

  // ── Circuit state
  const [templates, setTemplates] = useState<CircuitTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [code, setCode] = useState('');
  const [filename, setFilename] = useState('circuit.circom');
  const [compileState, setCompileState] = useState<CompileState>('idle');
  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null);

  // ── Verifier state
  const [validVk, setValidVk] = useState<SnarkJsVk | null>(null);
  const [generateState, setGenerateState] = useState<GenerateState>('idle');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [verifier, setVerifier] = useState<GeneratedVerifier | null>(null);
  const [activeFile, setActiveFile] = useState<ActiveFile>('groth16_verifier.cairo');
  const [isRootOpen, setIsRootOpen] = useState(true);
  const [isSrcOpen, setIsSrcOpen] = useState(true);

  // ── Deployment State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployClassHash, setDeployClassHash] = useState<string | null>(null);

  const addLog = useCallback((msg: string, type: LogType = 'info') => {
    setLogs((prev) => [...prev, { id: crypto.randomUUID(), timestamp: new Date(), message: msg, type }]);
  }, []);

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

  // ── Generate
  const handleGenerate = useCallback(async () => {
    if (!validVk) return;
    setGenerateState('generating');
    setGenerateError(null);
    setVerifier(null);
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
        setActiveFile('groth16_verifier.cairo');
      } else {
        setGenerateState('error');
        setGenerateError(data.error);
      }
    } catch (err) {
      setGenerateState('error');
      setGenerateError(String(err));
    }
  }, [validVk]);

  // ── Deploy Handlers
  const handleCompileAndDeclare = useCallback(async () => {
    if (!account || !verifier) return;
    setIsDeploying(true);
    addLog('Starting API compilation (Cairo → Sierra/Casm)...', 'info');

    try {
      const compileRes = await fetch('/api/verifier/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifier),
      });
      const compileData = await compileRes.json();
      
      if (!compileData.success) {
        throw new Error(compileData.error || 'Compilation failed');
      }
      addLog('Compilation successful. Requesting wallet signature to Declare...', 'success');

      // Declare
      const declareResponse = await account.declare({
        contract: compileData.sierra,
        casm: compileData.casm,
      });
      
      addLog(`Declare TX sent: ${declareResponse.transaction_hash}. Waiting for L2 acceptance...`, 'info');
      await account.waitForTransaction(declareResponse.transaction_hash);
      
      addLog(`Contract declared successfully! Class Hash: ${declareResponse.class_hash}`, 'success');
      setDeployClassHash(declareResponse.class_hash);
    } catch (err: any) {
      addLog(`Declare failed: ${err.message || String(err)}`, 'error');
    } finally {
      setIsDeploying(false);
    }
  }, [account, verifier, addLog]);

  const handleDeploy = useCallback(async () => {
    if (!account || !deployClassHash) return;
    setIsDeploying(true);
    try {
      addLog('Requesting wallet signature to Deploy...', 'info');
      const deployResponse = await account.deployContract({
        classHash: deployClassHash,
        constructorCalldata: [],
      });
      
      addLog(`Deploy TX sent: ${deployResponse.transaction_hash}. Waiting for L2 acceptance...`, 'info');
      await account.waitForTransaction(deployResponse.transaction_hash);
      
      addLog(`Contract deployed successfully! Address: ${deployResponse.contract_address}`, 'success');
    } catch (err: any) {
      addLog(`Deploy failed: ${err.message || String(err)}`, 'error');
    } finally {
      setIsDeploying(false);
    }
  }, [account, deployClassHash, addLog]);

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

  // Col3 divider (left of col3): drag right → col3 narrower (divider moves right = less col3)
  const dragCol3Divider = useCallback((e: React.MouseEvent) => {
    const startW = col3WRef.current;
    startDrag(e, 'h', (dx) => setCol3Width(Math.max(220, Math.min(700, startW - dx))));
  }, [setCol3Width]);

  // Row1 divider (above compile output in col1): drag down → output panel smaller
  const dragRow1Divider = useCallback((e: React.MouseEvent) => {
    const startH = outH1Ref.current;
    startDrag(e, 'v', (dy) => setOut1(Math.max(60, Math.min(600, startH - dy))));
  }, [setOut1]);

  // Row3 divider (above generate output in col3): drag down → generate panel smaller
  const dragRow3Divider = useCallback((e: React.MouseEvent) => {
    const startH = outH3Ref.current;
    startDrag(e, 'v', (dy) => setOut3(Math.max(60, Math.min(600, startH - dy))));
  }, [setOut3]);

  // Row2 divider (above deployment logs in col2): drag down → logs panel smaller
  const dragRow2Divider = useCallback((e: React.MouseEvent) => {
    const startH = outH2Ref.current;
    startDrag(e, 'v', (dy) => setOut2(Math.max(60, Math.min(600, startH - dy))));
  }, [setOut2]);


  // ── Helpers
  const libCairoContent = "mod groth16_verifier_constants;\nmod groth16_verifier;\n";
  const activeContent = verifier
    ? activeFile === 'Scarb.toml' ? verifier.scarbToml
    : activeFile === 'lib.cairo' ? libCairoContent
    : activeFile === 'groth16_verifier.cairo' ? verifier.verifierCairo
    : verifier.constantsCairo
    : '';

  const handleDownloadZip = useCallback(async () => {
    if (!verifier) return;
    const zip = new JSZip();
    zip.file('Scarb.toml', verifier.scarbToml);
    const src = zip.folder('src');
    if (src) {
      src.file('lib.cairo', "mod groth16_verifier_constants;\nmod groth16_verifier;\n");
      src.file('groth16_verifier.cairo', verifier.verifierCairo);
      src.file('groth16_verifier_constants.cairo', verifier.constantsCairo);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'groth16_verifier_project.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [verifier]);

  // ── Render
  return (
    <div className={styles.workspace}>

      {/* Header with template picker */}
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <span className={styles.logo}>◆</span>
          <h1 className={styles.title}>Cairo Verifier Generator</h1>
        </div>
        <p className={styles.subtitle}>Circom / Noir → Groth16 Cairo Verifier · Powered by Garaga</p>
      </header>

      {/* Resizable 3-column row */}
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
        <div className={`${styles.colWrap} ${styles.cairoPane}`} style={{ flex: 1, minWidth: 180 }}>
          
          {/* File tree sidebar - only show when verifier exists */}
          {verifier && (
          <div className={styles.fileTreeSidebar}>
            <div className={styles.paneLabelSmall} style={{ justifyContent: 'space-between' }}>
              <span>Project Files</span>
              <button
                className={styles.downloadIconBtn}
                onClick={handleDownloadZip}
                title="Download full project as ZIP"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </button>
            </div>
            <div className={styles.fileTreeContent}>
              <div 
                className={styles.fileTreeFolder} 
                onClick={() => setIsRootOpen(!isRootOpen)}
                style={{ cursor: 'pointer', paddingLeft: 8 }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, transform: isRootOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.1s' }}><polyline points="9 18 15 12 9 6"></polyline></svg>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><polygon points="3 6 9 6 12 9 21 9 21 19 3 19"></polygon></svg>
                groth16_verifier
              </div>
              
              {isRootOpen && (
                <>
                  <div
                    className={`${styles.fileTreeItem} ${activeFile === 'Scarb.toml' ? styles.fileTreeActive : ''}`}
                    onClick={() => setActiveFile('Scarb.toml')}
                    style={{ paddingLeft: 30, ...(activeFile === 'Scarb.toml' ? { paddingLeft: 28 } : {}) }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    Scarb.toml
                  </div>
                  <div 
                    className={styles.fileTreeFolder} 
                    onClick={() => setIsSrcOpen(!isSrcOpen)}
                    style={{ marginTop: 4, paddingLeft: 30, cursor: 'pointer' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, transform: isSrcOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.1s' }}><polyline points="9 18 15 12 9 6"></polyline></svg>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><polygon points="3 6 9 6 12 9 21 9 21 19 3 19"></polygon></svg>
                    src
                  </div>
                  
                  {isSrcOpen && (
                    <>
                      <div
                        className={`${styles.fileTreeItemNested} ${activeFile === 'lib.cairo' ? styles.fileTreeActive : ''}`}
                        onClick={() => setActiveFile('lib.cairo')}
                        style={{ paddingLeft: 52, ...(activeFile === 'lib.cairo' ? { paddingLeft: 50 } : {}) }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                        lib.cairo
                      </div>
                      <div
                        className={`${styles.fileTreeItemNested} ${activeFile === 'groth16_verifier.cairo' ? styles.fileTreeActive : ''}`}
                        onClick={() => setActiveFile('groth16_verifier.cairo')}
                        style={{ paddingLeft: 52, ...(activeFile === 'groth16_verifier.cairo' ? { paddingLeft: 50 } : {}) }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                        groth16_verifier.cairo
                      </div>
                      <div
                        className={`${styles.fileTreeItemNested} ${activeFile === 'groth16_verifier_constants.cairo' ? styles.fileTreeActive : ''}`}
                        onClick={() => setActiveFile('groth16_verifier_constants.cairo')}
                        style={{ paddingLeft: 52, ...(activeFile === 'groth16_verifier_constants.cairo' ? { paddingLeft: 50 } : {}) }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                        groth16_verifier_constants.cairo
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          )}

          <div className={styles.cairoMain}>
            {/* Content area */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className={styles.cairoContent} style={{ flex: 1, minHeight: 0 }}>
              {!verifier && generateState === 'idle' && (
                <div className={styles.cairoPlaceholder}>
                  <p>Upload a VK on the right, then click <strong>⬡ Generate</strong></p>
                </div>
              )}
              {generateState === 'generating' && (
                <div className={styles.cairoPlaceholder}>
                  <span className={styles.spinner} />&nbsp;Generating Cairo verifier…
                </div>
              )}
              {generateState === 'error' && (
                <div className={styles.cairoPlaceholderError}>✗ {generateError}</div>
              )}
              {verifier && <pre className={styles.cairoCode}>{activeContent}</pre>}
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
          </div>

          {/* Deploy bar — only when verifier exists */}
          {verifier && (
            <div className={styles.deployBar}>
              {isConnected ? (
                <>
                  <span className={styles.deployLabel} title={address || ''}>
                    Starknet Wallet ({address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connected'})
                  </span>
                  <button
                    id="declare-btn"
                    className={styles.declareBtn}
                    onClick={handleCompileAndDeclare}
                    disabled={isDeploying}
                  >
                    Compile & Declare
                  </button>
                  <button
                    id="deploy-btn"
                    className={styles.deployBtn}
                    onClick={handleDeploy}
                    disabled={isDeploying || !deployClassHash}
                  >
                    Deploy
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

        {/* ── Col divider: resize col3 ── */}
        <div className={styles.colDivider} onMouseDown={dragCol3Divider} />

        {/* ── Col 3: VK panel (top) + generate output (bottom) ── */}
        <div className={styles.colWrap} style={{ width: col3Width, flexShrink: 0 }}>
          <div className={styles.paneLabelSmall}><span>Verification Key</span></div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <VkPanel
              onValidVk={(vk) => setValidVk(vk)}
              onClearVk={() => { setValidVk(null); setVerifier(null); setGenerateState('idle'); }}
            />
          </div>
          {/* Row drag handle → resize generate panel */}
          <div className={styles.rowDivider} onMouseDown={dragRow3Divider} />
          {/* Generate output + button */}
          <div className={styles.outputPanel} style={{ height: outputHeight3 }}>
            <div className={styles.paneLabelSmall}>
              <span>Verifier</span>
              {validVk && (
                <button
                  id="generate-btn"
                  className={`${styles.generateBtn} ${styles.btnSm} ${generateState === 'generating' ? styles.generating : ''}`}
                  onClick={handleGenerate}
                  disabled={generateState === 'generating'}
                >
                  {generateState === 'generating'
                    ? <><span className={styles.spinner} /> Generating…</>
                    : '⬡ Generate'}
                </button>
              )}
            </div>
            <div className={styles.outputContent}>
              {generateState === 'idle' && !validVk && <p className={styles.outputHint}>Upload a VK to generate a Cairo verifier.</p>}
              {generateState === 'idle' && validVk && <p className={styles.outputHint}>VK validated ✓ — click ⬡ Generate.</p>}
              {generateState === 'generating' && <p className={styles.outputHint}><span className={styles.spinner} /> Generating Cairo verifier…</p>}
              {generateState === 'error' && (
                <div className={styles.errorList}>
                  <div className={styles.errorHeader}>✗ Generation failed</div>
                  <div className={styles.errorItem}><span className={styles.errorMessage}>{generateError}</span></div>
                </div>
              )}
              {generateState === 'success' && verifier && (
                <div className={styles.successBlock}>
                  <div className={styles.successHeader}>✓ Verifier generated</div>
                  <table className={styles.statsTable}><tbody>
                    <tr><td>Project</td><td><strong>{verifier.projectName}</strong></td></tr>
                  </tbody></table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
