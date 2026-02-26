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

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '999999';
  overlay.style.cursor = axis === 'h' ? 'col-resize' : 'row-resize';
  document.body.appendChild(overlay);

  document.body.style.cursor = axis === 'h' ? 'col-resize' : 'row-resize';
  document.body.style.userSelect = 'none';
  const move = (ev: MouseEvent) => onMove((axis === 'h' ? ev.clientX : ev.clientY) - startPos);
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

export type PipelineStage = 'editor' | 'compile' | 'setup' | 'prove' | 'verifier';

interface EditorWorkspaceProps {
  activeStage: PipelineStage;
  setActiveStage: (stage: PipelineStage) => void;
  onNavigateToVk: () => void;
}

export default function EditorWorkspace({ activeStage, setActiveStage, onNavigateToVk }: EditorWorkspaceProps) {
  const { account, address, wallet, chainId, isConnected, connectWallet, disconnectWallet } = useStarknetWallet();
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);

  // ── Sizes — stored in refs for getValue() snapshots, synced to state for renders
  const col1WRef = useRef(650);
  const outH1Ref = useRef(180);
  const outH2Ref = useRef(150);

  const [col1Width, _setCol1Width] = useState(650);
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

  // ── Setup state
  const [setupState, setSetupState] = useState<CompileState>('idle');
  const [setupResult, setSetupResult] = useState<any>(null);

  // ── Prove state
  const [proveState, setProveState] = useState<CompileState>('idle');
  const [proveResult, setProveResult] = useState<any>(null);
  const [signalsInput, setSignalsInput] = useState('{\n  "a": 3,\n  "b": 11\n}');

  // ── Uploaded Artifacts overrides
  const [uploadedR1cs, setUploadedR1cs] = useState<string | null>(null);
  const [uploadedWasm, setUploadedWasm] = useState<string | null>(null);
  const [uploadedZkey, setUploadedZkey] = useState<string | null>(null);
  const [uploadedVk, setUploadedVk] = useState<string | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<'r1cs' | 'wasm' | 'sym'>('r1cs');
  const [copiedJSON, setCopiedJSON] = useState(false);

  // ── Upload Handlers
  const parseBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  const handleUploadR1cs = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      setUploadedR1cs(parseBufferToBase64(buffer));
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, []);

  const handleUploadWasm = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      setUploadedWasm(parseBufferToBase64(buffer));
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, []);

  const handleUploadZkey = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      setUploadedZkey(parseBufferToBase64(buffer));
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, []);

  const handleUploadVk = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadedVk(ev.target?.result as string);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleDownload = useCallback((base64Data: string, dlFilename: string, mimeType: string) => {
    const binary = window.atob(base64Data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    const blob = new Blob([array], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dlFilename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

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
    isCheckingDeclaration,
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

  // ── Setup
  const handleSetup = useCallback(async () => {
    const r1csBase64 = uploadedR1cs || (compileResult as any)?.result?.r1csBase64;
    // Don't require compileResult if uploadedR1cs is provided
    if (!r1csBase64) return;
    
    setSetupState('compiling');
    setSetupResult(null);

    try {
      const resp = await fetch('/api/circuit/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r1csBase64 })
      });
      const result = await resp.json();
      
      setSetupResult(result);
      setSetupState(result.success ? 'success' : 'error');
      
    } catch (err) {
      console.error('Setup failed:', err);
      setSetupState('error');
    }
  }, [compileResult, uploadedR1cs]);

  // ── Prove
  const handleProve = useCallback(async () => {
    const wasmBase64 = uploadedWasm || (compileResult as any)?.result?.wasmBase64;
    const zkeyBase64 = uploadedZkey || setupResult?.zkeyBase64;
    
    if (!wasmBase64 || !zkeyBase64) return;
    
    setProveState('compiling');
    setProveResult(null);

    try {
      let parsedSignals: any;
      try {
        parsedSignals = JSON.parse(signalsInput);
      } catch(e) {
        throw new Error("Invalid Private/Public Inputs JSON format.");
      }

      const resp = await fetch('/api/circuit/prove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          wasmBase64,
          zkeyBase64,
          signals: parsedSignals
        })
      });
      const result = await resp.json();
      
      setProveResult(result);
      setProveState(result.success ? 'success' : 'error');
      
    } catch (err: any) {
      console.error('Proving failed:', err);
      setProveResult({ success: false, error: err.message || String(err) });
      setProveState('error');
    }
  }, [compileResult, setupResult, signalsInput, uploadedWasm, uploadedZkey]);

  // ── Generate Verifier
  const handleGenerate = useCallback(async () => {
    const vkJsonString = uploadedVk || setupResult?.vkJson;
    if (!vkJsonString) return;
    
    setGenerateState('generating');
    setGenerateError(null);
    setVerifier(null);
    
    try {
      // Setup result actually serves back the `vkJson` explicitly.
      const vkObj = typeof vkJsonString === 'string' ? JSON.parse(vkJsonString) : vkJsonString;

      const resp = await fetch('/api/verifier/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vk: vkObj,
          contractName: filename.replace('.circom', '')
        })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to generate verifier (${resp.status})`);
      }

      const data: GeneratedVerifier = await resp.json();
      setVerifier(data);
      setGenerateState('success');
      
      // Auto-switch to verifier tab to see output
      setActiveStage('verifier');

    } catch (err: any) {
      console.error('Generation failed:', err);
      setGenerateError(err.message || String(err));
      setGenerateState('error');
    }
  }, [setupResult, filename]);




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
  const baseName = filename.replace('.circom', '');
  const r1csName = `${baseName}.r1cs`;
  const wasmName = `${baseName}.wasm`;
  const symName = `${baseName}.sym`;

  // Define the isolated Editor Node
  const editorPane = (
    <>
      <div className={styles.editorRow} style={{ flex: 1, display: 'flex', flexDirection: 'row', height: '100%', minHeight: 0 }}>
      {/* Col 1: Editor & Actions & Output */}
      <div className={styles.colWrap} style={{ width: col1Width, display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0, minWidth: 0 }}>
        
        {/* TOP HALF: Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Pane label: file language switcher + template picker */}
          <div className={styles.paneLabel} style={{ flexShrink: 0, flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className={styles.paneLabelLeft}>
                <span>{filename}</span>
                <div className={styles.langSwitcher}>
                  <span className={styles.langActive}>Circom 2.0</span>
                  <span className={styles.langSoon} title="Coming soon">Noir</span>
                </div>
              </div>
            </div>
            <div className={styles.templatePicker} style={{ width: '100%', justifyContent: 'flex-start' }}>
              <label htmlFor="template-select" className={styles.label} style={{ minWidth: 70 }}>Template</label>
              <select
                id="template-select"
                className={styles.select}
                value={selectedId}
                onChange={(e) => {
                  const t = templates.find((t) => t.id === e.target.value);
                  if (t) applyTemplate(t);
                }}
                style={{ flex: 1, maxWidth: 300 }}
              >
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          {/* Monaco fills remaining height */}
          <div className={styles.monacoWrap} style={{ flex: 1, minHeight: 0 }}>
            <MonacoEditor
              height="100%"
              defaultLanguage="rust"
              theme="vs-dark"
              value={code}
              onChange={(v) => {
                const val = v ?? '';
                if (val !== code) setCode(val);
              }}
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
          
          <div className={styles.hideOnMobile} style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px', background: '#0a0a0c', borderTop: '1px solid #334155', flexShrink: 0 }}>
             <button
               id="compile-btn"
               className={`${styles.compileBtn} ${styles[compileState]}`}
               onClick={handleCompile}
               disabled={compileState === 'compiling'}
               style={{ padding: '6px 16px', fontSize: 12, height: 'auto', borderRadius: 4 }}
             >
               {compileState === 'compiling' ? <span className={styles.spinner} style={{ marginRight: 8 }} /> : 'Compile'}
             </button>
          </div>
        </div>

        <div className={`${styles.rowDivider} ${styles.desktopCompilerLogs}`} onMouseDown={dragRow1Divider} style={{ cursor: 'row-resize', padding: '4px 0', margin: '-4px 0', backgroundClip: 'content-box', height: 14, minHeight: 14, zIndex: 10, flexShrink: 0 }} />

        {/* BOTTOM HALF: Compilation Logs (Desktop Position) */}
        <div className={styles.desktopCompilerLogs} style={{ height: outputHeight1, minHeight: 60, display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#0a0a0c' }}>
          <div className={styles.paneLabelSmall} style={{ flexShrink: 0 }}>
            <span>Compiler Output</span>
          </div>
          <div className={styles.outputContent} style={{ flex: 1, overflowY: 'auto' }}>
            {compileState === 'idle' && <p className={styles.outputHint}>Click <b>▶ Compile Circuit</b> to compile your `.circom` code.</p>}
            {compileState === 'compiling' && <p className={styles.outputHint}>Compiling constraints and generating WebAssembly witness calculator…</p>}
            
            {compileState === 'success' && compileResult?.success && (
              <div className={styles.successBlock} style={{ fontSize: 13, padding: 16 }}>
                <div style={{ color: '#10b981', marginBottom: 8, fontWeight: 600 }}>✓ Circuit Compiled Successfully</div>
                
                <table className={styles.statsTable} style={{ marginBottom: 12 }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingRight: 32, paddingBottom: 4 }}>Non-linear constraints</td>
                      <td style={{ paddingBottom: 4 }}><strong>{(compileResult.result as any).constraintCount}</strong></td>
                    </tr>
                    {(compileResult.result as any).wireCount !== undefined && (
                      <tr>
                        <td style={{ paddingRight: 32 }}>Wires</td>
                        <td><strong>{(compileResult.result as any).wireCount}</strong></td>
                      </tr>
                    )}
                  </tbody>
                </table>
                
                {(compileResult.result as any).warnings.length > 0 && (
                  <div className={styles.warningsList} style={{ marginTop: 12 }}>
                    <strong>Warnings:</strong>
                    <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                      {(compileResult.result as any).warnings.map((w: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
            
            {compileState === 'error' && compileResult && !compileResult.success && (
              <div className={styles.errorList} style={{ padding: 16 }}>
                <div className={styles.errorHeader} style={{ marginBottom: 12 }}>✗ Compilation failed</div>
                {compileResult.errors.map((e, i) => (
                  <div key={i} className={styles.errorItem} style={{ marginBottom: 12 }}>
                    <span className={styles.errorCategory}>{e.category}</span>
                    <span className={styles.errorMessage}>{e.message.replace(/\x1B\[[0-9;]*m/g, '')}</span>
                    {e.line && <span className={styles.errorLocation} style={{ display: 'block', marginTop: 4 }}>line {e.line}{e.column ? `:${e.column}` : ''}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.colDivider} onMouseDown={dragCol1Divider} style={{ zIndex: 10 }} />

      {/* Col 2: Artifacts File Tree & Upload */}
      <div className={`${styles.colWrap} ${!(compileState === 'success' && compileResult?.success) ? styles.hideOnMobileEmpty : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {compileState === 'success' && compileResult?.success ? (
          <div className={styles.viewerRoot} style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
            {/* Artifacts Top-level Sidebar */}
            <div className={styles.fileTreeSidebar} style={{ width: 220, borderRight: '1px solid #222', background: 'transparent', flexShrink: 0, overflowY: 'auto' }}>
              <div className={styles.paneLabelSmall}>
                <span>Compiled Artifacts</span>
              </div>
              <div className={styles.fileTreeContent}>
                 <div className={styles.fileTreeFolder} style={{ cursor: 'default', paddingLeft: 8, color: '#e2e8f0', marginBottom: 12, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}><polygon points="3 6 9 6 12 9 21 9 21 19 3 19"></polygon></svg>
                   {filename.replace('.circom', '')} Outputs
                 </div>

                 <div className={styles.fileTreeGroup}>
                   {(compileResult.result as any).r1csBase64 && (
                     <div 
                       className={`${styles.fileTreeItem} ${activeArtifact === 'r1cs' ? styles.fileTreeActive : ''}`} 
                       onClick={() => setActiveArtifact('r1cs')}
                       style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderRadius: 4, cursor: 'pointer', ... (activeArtifact === 'r1cs' ? { background: 'rgba(255,255,255,0.1)' } : {}) }}
                     >
                       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, color: '#64748b' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                       <span style={{ fontSize: 13, userSelect: 'none' }}>{r1csName}</span>
                     </div>
                   )}
                   {(compileResult.result as any).wasmBase64 && (
                     <div 
                       className={`${styles.fileTreeItem} ${activeArtifact === 'wasm' ? styles.fileTreeActive : ''}`} 
                       onClick={() => setActiveArtifact('wasm')}
                       style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderRadius: 4, cursor: 'pointer', ... (activeArtifact === 'wasm' ? { background: 'rgba(255,255,255,0.1)' } : {}) }}
                     >
                       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, color: '#64748b' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                       <span style={{ fontSize: 13, userSelect: 'none' }}>{wasmName}</span>
                     </div>
                   )}
                   {(compileResult.result as any).symContent && (
                     <div 
                       className={`${styles.fileTreeItem} ${activeArtifact === 'sym' ? styles.fileTreeActive : ''}`} 
                       onClick={() => setActiveArtifact('sym')}
                       style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderRadius: 4, cursor: 'pointer', ... (activeArtifact === 'sym' ? { background: 'rgba(255,255,255,0.1)' } : {}) }}
                     >
                       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, color: '#64748b' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                       <span style={{ fontSize: 13, userSelect: 'none' }}>{symName}</span>
                     </div>
                   )}
                 </div>
              </div>
            </div>
            
            {/* Main Content Area (Artifact Viewing Pane) */}
            <div className={styles.cairoMain} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className={styles.paneLabelSmall} style={{ borderBottom: '1px solid #222', background: '#0a0a0c', justifyContent: 'space-between' }}>
                <span>{activeArtifact === 'r1cs' ? r1csName : activeArtifact === 'wasm' ? wasmName : symName}</span>
                {/* Independent Download Button */}
                {activeArtifact === 'r1cs' && (compileResult.result as any).r1csBase64 && (
                   <button onClick={() => handleDownload((compileResult.result as any).r1csBase64, r1csName, 'application/octet-stream')} className={styles.downloadIconBtn} style={{ padding: '2px 8px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}>
                     ↓ Download
                   </button>
                )}
                {activeArtifact === 'wasm' && (compileResult.result as any).wasmBase64 && (
                   <button onClick={() => handleDownload((compileResult.result as any).wasmBase64, wasmName, 'application/wasm')} className={styles.downloadIconBtn} style={{ padding: '2px 8px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}>
                     ↓ Download
                   </button>
                )}
                {activeArtifact === 'sym' && (compileResult.result as any).symContent && (
                   <button onClick={() => handleDownload(window.btoa((compileResult.result as any).symContent), symName, 'text/plain')} className={styles.downloadIconBtn} style={{ padding: '2px 8px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}>
                     ↓ Download
                   </button>
                )}
              </div>
              <div style={{ flex: 1, padding: 32, overflowY: 'auto', background: '#0a0a0c' }}>
                {activeArtifact === 'r1cs' && (
                  <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: '1.6' }}>
                     <h3 style={{ color: '#e2e8f0', marginBottom: 12, fontSize: 15 }}>Rank-1 Constraint System (R1CS)</h3>
                     <p style={{ marginBottom: 16 }}>This is a binary file representing the arithmetic circuit constraints generated by the Circom compiler.</p>
                     <p>It acts as the primary input required by SnarkJS and Garaga during the <strong>Trusted Setup Phase 2</strong> ceremony to generate the proving `.zkey` and verifying keys.</p>
                     
                     <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid #222' }}>
                       <span style={{ display: 'block', color: '#64748b', fontSize: 11, marginBottom: 4 }}>FILE TYPE</span>
                       <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>application/octet-stream (Binary)</span>
                     </div>
                     
                     <div style={{ marginTop: 32, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 24 }}>
                       <button 
                         className={styles.compileBtn}
                         onClick={() => {
                           setActiveStage('setup');
                         }}
                         style={{ padding: '8px 16px', fontSize: 12 }}
                       >
                         Use R1CS for Trusted Setup →
                       </button>
                     </div>
                  </div>
                )}
                {activeArtifact === 'wasm' && (
                  <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: '1.6' }}>
                     <h3 style={{ color: '#e2e8f0', marginBottom: 12, fontSize: 15 }}>WebAssembly Witness Calculator</h3>
                     <p style={{ marginBottom: 16 }}>This `.wasm` artifact contains the executable logic to compute the signals (witness) of the circuit.</p>
                     <p>It is strictly required during the <strong>Proof Generation</strong> phase, where it processes the user's private and public inputs to formulate a valid cryptographic proof.</p>
                     
                     <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid #222' }}>
                       <span style={{ display: 'block', color: '#64748b', fontSize: 11, marginBottom: 4 }}>FILE TYPE</span>
                       <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>application/wasm (Binary)</span>
                     </div>
                     
                     <div style={{ marginTop: 32, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 24 }}>
                       <button 
                         className={styles.compileBtn}
                         onClick={() => {
                           setActiveStage('prove');
                         }}
                         style={{ padding: '8px 16px', fontSize: 12 }}
                       >
                         Use WASM for Proving Phase →
                       </button>
                     </div>
                  </div>
                )}
                {activeArtifact === 'sym' && (
                  <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: '1.6' }}>
                     <h3 style={{ color: '#e2e8f0', marginBottom: 12, fontSize: 15 }}>Symbols File</h3>
                     <p style={{ marginBottom: 16 }}>A plaintext debugging file mapping wire indices to constraint signals.</p>
                     <p>While not strictly required for setup or proving, the `.sym` file is heavily referenced for auditing and debugging compilation anomalies.</p>
                     
                     <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid #222' }}>
                       <span style={{ display: 'block', color: '#64748b', fontSize: 11, marginBottom: 4 }}>PREVIEW</span>
                       <pre style={{ margin: 0, padding: 12, background: '#111', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, color: '#a1a1aa', border: '1px solid #222', maxHeight: 200, overflowY: 'auto' }}>
                         {(compileResult.result as any).symContent || 'No visual preview available.'}
                       </pre>
                     </div>
                   </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13, background: '#0a0a0c' }}>
            <p>Generated artifacts will appear here after compilation.</p>
          </div>
        )}
      </div>
    </div>

    {/* MOBILE ONLY: Compilation Logs (Sticky Footer) */}
    <div className={styles.mobileCompilerLogs} style={{ minHeight: 60, display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#0a0a0c', borderTop: '1px solid #334155' }}>
      <div className={styles.paneLabelSmall} style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Compiler Output</span>
        <button
           id="compile-btn-mobile"
           className={`${styles.compileBtn} ${styles[compileState]}`}
           onClick={handleCompile}
           disabled={compileState === 'compiling'}
           style={{ padding: '4px 12px', fontSize: 11, height: 'auto', borderRadius: 4, margin: '-2px 0' }}
         >
           {compileState === 'compiling' ? <span className={styles.spinner} style={{ marginRight: 6, width: 12, height: 12, borderWidth: 2 }} /> : 'Compile Code'}
         </button>
      </div>
          <div className={styles.outputContent} style={{ flex: 1, overflowY: 'auto' }}>
            {compileState === 'idle' && <p className={styles.outputHint}>Click <b>▶ Compile Circuit</b> to compile your `.circom` code.</p>}
            {compileState === 'compiling' && <p className={styles.outputHint}>Compiling constraints and generating WebAssembly witness calculator…</p>}
            
            {compileState === 'success' && compileResult?.success && (
              <div className={styles.successBlock} style={{ fontSize: 13, padding: 16 }}>
                <div style={{ color: '#10b981', marginBottom: 8, fontWeight: 600 }}>✓ Circuit Compiled Successfully</div>
                
                <table className={styles.statsTable} style={{ marginBottom: 12 }}>
                  <tbody>
                    <tr>
                      <td style={{ paddingRight: 32, paddingBottom: 4 }}>Non-linear constraints</td>
                      <td style={{ paddingBottom: 4 }}><strong>{(compileResult.result as any).constraintCount}</strong></td>
                    </tr>
                    {(compileResult.result as any).wireCount !== undefined && (
                      <tr>
                        <td style={{ paddingRight: 32 }}>Wires</td>
                        <td><strong>{(compileResult.result as any).wireCount}</strong></td>
                      </tr>
                    )}
                  </tbody>
                </table>
                
                {(compileResult.result as any).warnings.length > 0 && (
                  <div className={styles.warningsList} style={{ marginTop: 12 }}>
                    <strong>Warnings:</strong>
                    <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                      {(compileResult.result as any).warnings.map((w: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
            
            {compileState === 'error' && compileResult && !compileResult.success && (
              <div className={styles.errorList} style={{ padding: 16 }}>
                <div className={styles.errorHeader} style={{ marginBottom: 12 }}>✗ Compilation failed</div>
                {compileResult.errors.map((e, i) => (
                  <div key={i} className={styles.errorItem} style={{ marginBottom: 12 }}>
                    <span className={styles.errorCategory}>{e.category}</span>
                    <span className={styles.errorMessage}>{e.message.replace(/\x1B\[[0-9;]*m/g, '')}</span>
                    {e.line && <span className={styles.errorLocation} style={{ display: 'block', marginTop: 4 }}>line {e.line}{e.column ? `:${e.column}` : ''}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
    </>
  );

  // Define the isolated Setup Node
  const setupPane = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
      {/* Col 1: Uploader + Generate button */}
      <div className={styles.colWrap} style={{ width: 400, display: 'flex', flexDirection: 'column', flexShrink: 0, padding: 24, overflowY: 'auto', borderRight: '1px solid #222' }}>
        <div className={styles.paneLabelSmall} style={{ marginBottom: 24 }}>
          <span>Trusted Setup (Phase 2)</span>
        </div>
        
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#e2e8f0', marginBottom: 8, fontWeight: 500 }}>Rank-1 Constraint System (.r1cs)</label>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px dashed #333' }}>
            <div className={styles.paneLabelSmall} style={{ borderBottom: '1px solid #222', background: '#0a0a0c', color: (uploadedR1cs || (compileResult as any)?.result?.r1csBase64) ? '#10b981' : '#64748b' }}>
              {uploadedR1cs || (compileResult as any)?.result?.r1csBase64 ? `✓ ${r1csName} ready` : 'Waiting for .r1cs file...'}
            </div>
            <label className={styles.uploadBtnSmall} style={{ cursor: 'pointer', padding: '6px 12px', background: '#334155', borderRadius: 6, fontSize: 12, color: '#e2e8f0' }}>
              Upload
              <input type="file" accept=".r1cs,application/octet-stream" onChange={handleUploadR1cs} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        <div>
          <button
            className={`${styles.compileBtn} ${styles[setupState]}`}
            onClick={handleSetup}
            disabled={setupState === 'compiling' || (!uploadedR1cs && !(compileResult as any)?.result?.r1csBase64)}
            style={{ width: '100%', padding: '12px 16px', fontSize: 13, borderRadius: 8 }}
          >
            {setupState === 'compiling'
              ? <><span className={styles.spinner} style={{ marginRight: 8 }} /> Generating Keys…</>
              : 'Generate Verification Key'}
          </button>
        </div>

        {setupState === 'error' && (
          <div className={styles.errorList} style={{ marginTop: 24, padding: 16 }}>
            <div className={styles.errorHeader}>✗ Setup failed</div>
            <div className={styles.errorItem}>
              <span className={styles.errorMessage}>{setupResult?.error || 'An error occurred during the Groth16 trusted setup phase.'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Col 2: Artifact/VK display */}
      <div className={styles.cairoMain} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className={styles.paneLabelSmall} style={{ borderBottom: '1px solid #222', background: '#0a0a0c', justifyContent: 'space-between' }}>
          <span>verification_key.json</span>
          {setupState === 'success' && setupResult?.success && (
            <button 
              className={styles.compileBtn}
              onClick={() => {
                localStorage.setItem('cairo_verifier_generator_pending_vk', setupResult.vkJson);
                onNavigateToVk();
              }}
              style={{ padding: '6px 12px', fontSize: 12, borderRadius: 4 }}
            >
              Generate Verifier →
            </button>
          )}
        </div>
        <div style={{ flex: 1, padding: 32, overflowY: 'auto', background: '#0a0a0c' }}>
          {setupState === 'success' && setupResult?.success ? (
            <div>
              <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>
                This is the verification key generated from your circuit's R1CS logic and the <strong>universal powersOfTau28_hez_final_14.ptau parameters</strong>. 
                It validates that the JSON matches the formats Garaga requires. Click <strong>Generate Verifier</strong> to proceed.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(setupResult.vkJson);
                    setCopiedJSON(true);
                    setTimeout(() => setCopiedJSON(false), 2000);
                  }}
                  className={styles.downloadIconBtn} style={{ padding: '4px 12px', fontSize: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                >
                  {copiedJSON ? <span style={{ color: '#10b981' }}>✓ Copied!</span> : 'Copy JSON'}
                </button>
                <button
                  onClick={() => handleDownload(window.btoa(setupResult.vkJson), 'verification_key.json', 'application/json')}
                  className={styles.downloadIconBtn} style={{ padding: '4px 12px', fontSize: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                >
                  ↓ Download JSON
                </button>
              </div>
              <pre style={{ margin: 0, padding: 16, background: '#111', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', border: '1px solid #222' }}>
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(setupResult.vkJson), null, 2);
                  } catch(e) { return setupResult.vkJson; }
                })()}
              </pre>
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
              <p>Generate a verification key to view its standard JSON contents here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Define the isolated Prove Node
  const provePane = (
    <div className={styles.colWrap} style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
      <div className={styles.paneLabelSmall} style={{ marginBottom: 16 }}>
        <span>Proof Generation Phase 3 (Witness + ZKey)</span>
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <p className={styles.outputHint} style={{ marginBottom: 12 }}>Provide the Private and Public inputs required by your circuit constraints:</p>
        <textarea
          style={{ width: '100%', height: 120, background: '#111114', border: '1px solid #333', color: '#fff', padding: 12, fontFamily: 'monospace', fontSize: 13, borderRadius: 6 }}
          value={signalsInput}
          onChange={(e) => setSignalsInput(e.target.value)}
          placeholder='{"a": 3, "b": 11}'
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <button
          className={`${styles.compileBtn} ${styles[proveState]}`}
          onClick={handleProve}
          disabled={proveState === 'compiling' || setupState !== 'success'}
          style={{ padding: '12px 24px', fontSize: 14 }}
        >
          {proveState === 'compiling'
            ? <><span className={styles.spinner} style={{ marginRight: 8 }} /> Generating Proof…</>
            : '▶ Compute Witness & Prove'}
        </button>
      </div>

      <div className={styles.outputContent} style={{ flex: 1 }}>
        {setupState !== 'success' && <p className={styles.outputHint}>Please generate a Trusted Setup Phase 2 (ZKey) first to generate proofs.</p>}
        {proveState === 'compiling' && <p className={styles.outputHint}>Computing Wasm Witness and synthesizing Snarkjs ZK Proof...</p>}
        
        {proveState === 'success' && proveResult?.success && (
          <div className={styles.successBlock} style={{ fontSize: 14, padding: 24 }}>
            <div className={styles.successHeader}>✓ Valid Zero-Knowledge Proof Generated</div>
            
            <div style={{ marginTop: 16, display: 'flex', gap: 24 }}>
              <div style={{ flex: 1 }}>
                <strong style={{ color: '#a1a1aa' }}>Public Signals:</strong><br/>
                <pre style={{ background: '#111', padding: 12, borderRadius: 6, marginTop: 8, fontSize: 12 }}>
                  {proveResult.publicInputsJson}
                </pre>
              </div>
            </div>

            {/* Advance Pipeline Button */}
            <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
               <button 
                 className={styles.compileBtn}
                 onClick={() => {
                   setActiveStage('verifier');
                   if (generateState === 'idle') {
                     handleGenerate();
                   }
                 }}
               >
                 Compile Cairo Smart Contract Verifier →
               </button>
            </div>
          </div>
        )}
        
        {proveState === 'error' && (
          <div className={styles.errorList} style={{ padding: 24 }}>
            <div className={styles.errorHeader}>✗ Proving failed</div>
            <div className={styles.errorItem}>
              <span className={styles.errorMessage}>{proveResult?.error || 'An unknown error occurred during Groth16 proof generation. Check your inputs against the constraints.'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.workspace} style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%' }}>
      {activeStage === 'editor' && editorPane}
      {activeStage === 'setup' && setupPane}
      {activeStage === 'prove' && provePane}
      {activeStage === 'verifier' && (
        <div className={`${styles.colWrap} ${styles.cairoPane}`} style={{ flex: 1, position: 'relative' }}>
          <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0 }}>
            <ScarbProjectViewer 
              verifier={verifier} 
              generateState={generateState} 
              generateError={generateError}
              emptyMessage="Generate a verifier to see the Cairo output here."
            />
          </div>
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
                  <button onClick={connectWallet} className={styles.connectWalletBtn}>Connect Wallet</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
