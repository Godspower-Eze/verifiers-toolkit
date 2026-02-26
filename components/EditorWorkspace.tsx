'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as MonacoNS from 'monaco-editor';
import type { CircuitTemplate } from '@/lib/circom/circuitTemplates';
import type { CompileError, CompileResponse } from '@/lib/circom/types';
import styles from './EditorWorkspace.module.css';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

/**
 * Parses a Circom source file for `signal input` declarations and returns
 * a template object with each input signal set to 0.
 *
 * Handles:
 *   - Scalar inputs:     `signal input a;`      → { a: 0 }
 *   - Fixed-size arrays: `signal input a[3];`   → { "a[0]": 0, "a[1]": 0, "a[2]": 0 }
 *
 * Variable-size arrays (e.g. `signal input a[n]`) are skipped since the size
 * is not statically known.
 */
function parseCircomInputSignals(source: string): Record<string, number> {
  const result: Record<string, number> = {};
  const arrayNames = new Set<string>();

  const arrayRegex = /signal\s+input\s+(\w+)\s*\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrayRegex.exec(source)) !== null) {
    const name = m[1];
    const size = parseInt(m[2], 10);
    arrayNames.add(name);
    for (let i = 0; i < size; i++) {
      result[`${name}[${i}]`] = 0;
    }
  }

  const scalarRegex = /signal\s+input\s+(\w+)\s*;/g;
  while ((m = scalarRegex.exec(source)) !== null) {
    const name = m[1];
    if (!arrayNames.has(name)) result[name] = 0;
  }

  return result;
}

type CompileState = 'idle' | 'compiling' | 'success' | 'error';

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

interface EditorWorkspaceProps {
  onNavigateToVk: () => void;
}

export default function EditorWorkspace({ onNavigateToVk }: EditorWorkspaceProps) {
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);

  // ── Sizes — stored in refs for getValue() snapshots, synced to state for renders
  const col1WRef = useRef(650);
  const outH1Ref = useRef(180);

  const [col1Width, _setCol1Width] = useState(650);
  const [outputHeight1, _setOutputHeight1] = useState(180);

  // Setters that keep refs in sync
  const setCol1Width = useCallback((v: number) => { col1WRef.current = v; _setCol1Width(v); }, []);
  const setOut1 = useCallback((v: number) => { outH1Ref.current = v; _setOutputHeight1(v); }, []);

  // ── Circuit state
  const [templates, setTemplates] = useState<CircuitTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [code, setCode] = useState('');
  const [filename, setFilename] = useState('circuit.circom');
  const [compileState, setCompileState] = useState<CompileState>('idle');
  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null);

  // ── Setup state
  const [setupState, setSetupState] = useState<CompileState>('idle');
  const [vkState, setVkState] = useState<CompileState>('idle');
  const [setupResult, setSetupResult] = useState<any>(null);

  // ── Prove state
  const [proveState, setProveState] = useState<CompileState>('idle');
  const [proveResult, setProveResult] = useState<any>(null);
  const [signalsInput, setSignalsInput] = useState('{\n  "a": 3,\n  "b": 11\n}');

  // ── Right-column tab state
  const [rightTab, setRightTab] = useState<'setup' | 'prove'>('setup');

  // ── Copy feedback states
  const [copiedVk, setCopiedVk] = useState(false);
  const [copiedProof, setCopiedProof] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState(false);

  // ── Derived availability
  const hasWasm = !!(compileResult as any)?.result?.wasmBase64;
  const hasZkey = !!setupResult?.zkeyBase64;

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

  // ── Auto-populate signal inputs from source on successful compilation
  useEffect(() => {
    if (compileState !== 'success') return;
    const signals = parseCircomInputSignals(code);
    if (Object.keys(signals).length > 0) {
      setSignalsInput(JSON.stringify(signals, null, 2));
    }
    setRightTab('setup');
  }, [compileState, code]);

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
    const r1csBase64 = (compileResult as any)?.result?.r1csBase64;
    if (!r1csBase64) return;

    setSetupState('compiling');
    setSetupResult(null);
    setVkState('idle');

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
  }, [compileResult]);

  // ── Export VK
  const handleExportVk = useCallback(async () => {
    const zkeyBase64 = setupResult?.zkeyBase64;
    if (!zkeyBase64) return;

    setVkState('compiling');

    try {
      const resp = await fetch('/api/circuit/export-vk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zkeyBase64 })
      });
      const result = await resp.json();
      if (result.success) {
        setSetupResult((prev: any) => ({ ...prev, vkJson: result.vkJson }));
        setVkState('success');
      } else {
        setVkState('error');
        setSetupResult((prev: any) => ({ ...prev, error: result.error }));
      }
    } catch (err) {
      console.error('Export VK failed:', err);
      setVkState('error');
    }
  }, [setupResult]);

  // ── Prove
  const handleProve = useCallback(async () => {
    const wasmBase64 = (compileResult as any)?.result?.wasmBase64;
    const zkeyBase64 = setupResult?.zkeyBase64;

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
  }, [compileResult, setupResult, signalsInput]);

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

  // ── Drag handlers
  const dragCol1Divider = useCallback((e: React.MouseEvent) => {
    const startW = col1WRef.current;
    startDrag(e, 'h', (dx) => setCol1Width(Math.max(220, Math.min(900, startW + dx))));
  }, [setCol1Width]);

  const dragRow1Divider = useCallback((e: React.MouseEvent) => {
    const startH = outH1Ref.current;
    startDrag(e, 'v', (dy) => setOut1(Math.max(60, Math.min(600, startH - dy))));
  }, [setOut1]);

  // ── Render
  const baseName = filename.replace('.circom', '');
  const r1csName = `${baseName}.r1cs`;
  const wasmName = `${baseName}.wasm`;

  return (
    <div className={styles.workspace} style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%' }}>

      {/* ── Left column: Editor ── */}
      <div className={styles.colWrap} style={{ width: col1Width, display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0, minWidth: 0 }}>

        {/* TOP: Monaco editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* Pane label + template picker */}
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

          {/* Compile button (desktop) */}
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

        {/* Row divider (desktop) */}
        <div
          className={`${styles.rowDivider} ${styles.desktopCompilerLogs}`}
          onMouseDown={dragRow1Divider}
          style={{ cursor: 'row-resize', padding: '4px 0', margin: '-4px 0', backgroundClip: 'content-box', height: 14, minHeight: 14, zIndex: 10, flexShrink: 0 }}
        />

        {/* BOTTOM: Compiler output (desktop) */}
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

      {/* ── Column divider ── */}
      <div className={styles.colDivider} onMouseDown={dragCol1Divider} style={{ zIndex: 10 }} />

      {/* ── Right column: Setup / Prove ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {compileState !== 'success' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13, background: '#0a0a0c' }}>
            <p>Compiled artifacts will appear here.</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 32, borderBottom: '1px solid #222', padding: '0 24px', background: '#0a0a0c' }}>
              <button
                onClick={() => setRightTab('setup')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: rightTab === 'setup' ? '2px solid #3b82f6' : '2px solid transparent',
                  color: rightTab === 'setup' ? '#f8fafc' : '#94a3b8',
                  padding: '16px 4px',
                  fontSize: 14,
                  fontWeight: rightTab === 'setup' ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                }}
              >
                Setup
              </button>
              <button
                onClick={() => setRightTab('prove')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: rightTab === 'prove' ? '2px solid #3b82f6' : '2px solid transparent',
                  color: rightTab === 'prove' ? '#f8fafc' : '#94a3b8',
                  padding: '16px 4px',
                  fontSize: 14,
                  fontWeight: rightTab === 'prove' ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                }}
              >
                Prove
              </button>
            </div>

            {/* ── Setup tab ── */}
            {rightTab === 'setup' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24, paddingBottom: 40 }}>

                <div style={{ padding: 20, background: 'linear-gradient(145deg, rgba(20,20,22,0.8) 0%, rgba(10,10,12,0.9) 100%)', border: '1px solid #222', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                  
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
                     <h3 style={{ margin: 0, fontSize: 14, color: '#e2e8f0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                       Trusted Setup Configuration
                     </h3>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Step 1: ZKey Generation */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #222', borderRadius: 8, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', fontSize: 12 }}>1</span>
                          <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>Proving Key Generation (ZKey)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: '#10b981', fontSize: 13 }}>✓</span>
                          <span style={{ color: '#10b981', fontSize: 13, fontWeight: 500 }}>{r1csName} attached</span>
                        </div>
                      </div>
                      
                      <p style={{ margin: 0, paddingLeft: 30, color: '#94a3b8', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                        This phase maps your R1CS constraints against the universal <code>powersOfTau</code> parameters to generate the unique ZKey needed for proving.
                      </p>

                      <div style={{ paddingLeft: 30 }}>
                        <button
                          className={`${styles.compileBtn} ${styles[setupState]}`}
                          onClick={handleSetup}
                          disabled={setupState === 'compiling' || setupState === 'success'}
                          style={{ width: '100%', padding: '12px 16px', fontSize: 13, borderRadius: 8, fontWeight: 600, transition: 'all 0.2s' }}
                        >
                          {setupState === 'compiling'
                            ? <><span className={styles.spinner} style={{ marginRight: 8 }} />Generating ZKey securely on Server…</>
                            : setupState === 'success'
                              ? '✓ ZKey Generated Successfully'
                              : 'Generate ZKey'}
                        </button>
                      </div>

                      {setupState === 'error' && (
                        <div className={styles.errorList} style={{ marginTop: 16, padding: 16, marginLeft: 30 }}>
                          <div className={styles.errorHeader}>✗ ZKey Generation failed</div>
                          <div className={styles.errorItem}>
                            <span className={styles.errorMessage}>{setupResult?.error || 'An error occurred during the Groth16 trusted setup phase.'}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Step 2: Verification Key Export (Revealed after Step 1) */}
                    <div style={{ 
                      background: setupState === 'success' ? 'rgba(59, 130, 246, 0.02)' : 'rgba(255,255,255,0.02)', 
                      border: setupState === 'success' ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid #222', 
                      borderRadius: 8, 
                      padding: 16,
                      opacity: setupState === 'success' ? 1 : 0.4,
                      pointerEvents: setupState === 'success' ? 'auto' : 'none',
                      transition: 'all 0.3s ease'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: setupState === 'success' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.05)', color: setupState === 'success' ? '#3b82f6' : '#64748b', fontSize: 12, transition: 'all 0.3s' }}>2</span>
                        <span style={{ color: setupState === 'success' ? '#e2e8f0' : '#a1a1aa', fontSize: 14, fontWeight: 600 }}>Verification Key Export</span>
                      </div>

                      <p style={{ margin: 0, paddingLeft: 30, color: '#94a3b8', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                        Extract the JSON representation of the Verifying Key from the compressed ZKey structure. This is required to deploy your Cairo verifier.
                      </p>

                      <div style={{ paddingLeft: 30 }}>
                        <button
                          className={`${styles.compileBtn} ${styles[vkState]}`}
                          onClick={handleExportVk}
                          disabled={vkState === 'compiling' || vkState === 'success' || setupState !== 'success'}
                          style={{ width: '100%', padding: '12px 16px', fontSize: 13, borderRadius: 8, fontWeight: 600, marginBottom: vkState === 'success' ? 24 : 0 }}
                        >
                          {vkState === 'compiling'
                            ? <><span className={styles.spinner} style={{ marginRight: 8 }} />Extracting Verification Key…</>
                            : vkState === 'success'
                              ? '✓ Verification Key Extracted'
                              : 'Export Verification Key'}
                        </button>
                      </div>

                      {vkState === 'error' && (
                        <div className={styles.errorList} style={{ marginTop: 16, padding: 16, marginLeft: 30 }}>
                          <div className={styles.errorHeader}>✗ VK Export failed</div>
                          <div className={styles.errorItem}>
                            <span className={styles.errorMessage}>{setupResult?.error || 'An error occurred during VK extraction.'}</span>
                          </div>
                        </div>
                      )}

                      {/* VK Output Display */}
                      {vkState === 'success' && setupResult?.vkJson && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out', paddingLeft: 30 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #222' }}>
                            <span className={styles.paneLabelSmall} style={{ color: '#10b981', fontSize: 14 }}>Verification Key</span>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => {
                              navigator.clipboard.writeText(setupResult.vkJson);
                              setCopiedVk(true);
                              setTimeout(() => setCopiedVk(false), 2000);
                            }}
                            className={styles.downloadIconBtn}
                            style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                          >
                            {copiedVk ? <span style={{ color: '#10b981' }}>✓ Copied</span> : 'Copy JSON'}
                          </button>
                          <button
                            onClick={() => handleDownload(window.btoa(setupResult.vkJson), 'verification_key.json', 'application/json')}
                            className={styles.downloadIconBtn}
                            style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                          >
                            ↓ Download
                          </button>
                        </div>
                      </div>
                      <pre style={{ margin: 0, padding: 16, background: '#0a0a0c', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', border: '1px solid #1e293b', overflowX: 'auto', maxHeight: 250, overflowY: 'auto' }}>
                        {(() => {
                          try { return JSON.stringify(JSON.parse(setupResult.vkJson), null, 2); }
                          catch(e) { return setupResult.vkJson; }
                        })()}
                      </pre>
                      
                      <div style={{ marginTop: 20, textAlign: 'right' }}>
                        <button
                          onClick={() => {
                            localStorage.setItem('cairo_verifier_generator_pending_vk', setupResult.vkJson);
                            onNavigateToVk();
                          }}
                          className={styles.compileBtn}
                          style={{ padding: '10px 20px', fontSize: 13, background: '#10b981', color: '#000', boxShadow: '0 0 15px rgba(16,185,129,0.3)' }}
                        >
                          Generate Cairo Verifier →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Prove tab ── */}
            {rightTab === 'prove' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 24, paddingBottom: 40 }}>

                <div style={{ padding: 20, background: 'linear-gradient(145deg, rgba(20,20,22,0.8) 0%, rgba(10,10,12,0.9) 100%)', border: '1px solid #222', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                  
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
                     <h3 style={{ margin: 0, fontSize: 14, color: '#e2e8f0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                       Zero-Knowledge Proof Generation
                     </h3>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                    {/* WASM status */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #222', borderRadius: 8, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontSize: 13 }}>✓</span>
                        <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{wasmName} attached</span>
                      </div>
                      <p style={{ margin: 0, paddingLeft: 30, color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                        The compiled WebAssembly executable representation of your circuit constraints. 
                        It is used by the prover to calculate the final <strong>witness</strong> vectors (intermediate signals) from your private inputs.
                      </p>
                    </div>

                    {/* ZKey status */}
                    <div style={{ background: hasZkey ? 'rgba(16, 185, 129, 0.02)' : 'rgba(255,255,255,0.02)', border: hasZkey ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid #333', borderRadius: 8, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: hasZkey ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.05)', color: hasZkey ? '#10b981' : '#64748b', fontSize: 13 }}>{hasZkey ? '✓' : '✗'}</span>
                        <span style={{ color: hasZkey ? '#e2e8f0' : '#a1a1aa', fontSize: 14, fontWeight: 600 }}>
                          {hasZkey ? 'ZKey attached' : 'Run Setup to attach ZKey'}
                        </span>
                      </div>
                      <p style={{ margin: 0, paddingLeft: 30, color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                        The cryptographic <strong>Proving Key</strong> generated exclusively during the Trusted Setup phase. 
                        It contains the specific cryptographic parameters required to mathematically prove knowledge of the calculated witness.
                      </p>
                    </div>
                  </div>

                  {/* Circuit Inputs */}
                  <div style={{ marginBottom: 24 }}>
                    <label style={{ display: 'block', fontSize: 13, color: '#e2e8f0', marginBottom: 8, fontWeight: 500 }}>Circuit Inputs (Private &amp; Public Signals)</label>
                    <div style={{ position: 'relative' }}>
                      <textarea
                        style={{ 
                          width: '100%', height: 160, background: '#0a0a0c', border: '1px solid #334155', color: '#e2e8f0', 
                          padding: 16, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 13, borderRadius: 8, 
                          boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.2s', resize: 'vertical'
                        }}
                        value={signalsInput}
                        onChange={(e) => setSignalsInput(e.target.value)}
                        placeholder='{"a": 3, "b": 11}'
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#334155'}
                      />
                      <div style={{ position: 'absolute', top: 12, right: 12, color: '#64748b', fontSize: 11, pointerEvents: 'none', background: 'rgba(10,10,12,0.8)', padding: '2px 6px', borderRadius: 4 }}>
                        JSON
                      </div>
                    </div>
                  </div>

                  {/* Create Proof button */}
                  <div style={{ marginBottom: proveState === 'success' ? 24 : 0 }}>
                    <button
                      className={`${styles.compileBtn} ${styles[proveState]}`}
                      onClick={handleProve}
                      disabled={proveState === 'compiling' || !hasZkey}
                      style={{ width: '100%', padding: '14px 16px', fontSize: 13, borderRadius: 8, fontWeight: 600, transition: 'all 0.2s' }}
                    >
                      {proveState === 'compiling'
                        ? <><span className={styles.spinner} style={{ marginRight: 8 }} />Computing Witness & Generating Proof…</>
                        : 'Create Proof'}
                    </button>
                  </div>

                  {/* Prove error */}
                  {proveState === 'error' && (
                    <div className={styles.errorList} style={{ marginTop: 16, padding: 16 }}>
                      <div className={styles.errorHeader}>✗ Proving failed</div>
                      <div className={styles.errorItem}>
                        <span className={styles.errorMessage}>{proveResult?.error || 'An unknown error occurred during Groth16 proof generation. Check your inputs against the constraints.'}</span>
                      </div>
                    </div>
                  )}

                  {/* Prove success */}
                  {proveState === 'success' && proveResult?.success && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out', borderTop: '1px solid #222', paddingTop: 24 }}>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        {/* Proof JSON */}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <span className={styles.paneLabelSmall} style={{ color: '#10b981', fontSize: 14 }}>Proof</span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(proveResult.proofJson);
                                  setCopiedProof(true);
                                  setTimeout(() => setCopiedProof(false), 2000);
                                }}
                                className={styles.downloadIconBtn}
                                style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                              >
                                {copiedProof ? <span style={{ color: '#10b981' }}>✓ Copied</span> : 'Copy'}
                              </button>
                              <button
                                onClick={() => handleDownload(window.btoa(proveResult.proofJson), 'proof.json', 'application/json')}
                                className={styles.downloadIconBtn}
                                style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                              >
                                ↓ Download
                              </button>
                            </div>
                          </div>
                          <pre style={{ margin: 0, padding: 12, background: '#0a0a0c', borderRadius: 6, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11, color: '#e2e8f0', border: '1px solid #1e293b', overflowX: 'auto', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                            {proveResult.proofJson}
                          </pre>
                        </div>

                        {/* Public Inputs JSON */}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <span className={styles.paneLabelSmall} style={{ color: '#10b981', fontSize: 14 }}>Public Inputs</span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(proveResult.publicInputsJson);
                                  setCopiedPublic(true);
                                  setTimeout(() => setCopiedPublic(false), 2000);
                                }}
                                className={styles.downloadIconBtn}
                                style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                              >
                                {copiedPublic ? <span style={{ color: '#10b981' }}>✓ Copied</span> : 'Copy'}
                              </button>
                              <button
                                onClick={() => handleDownload(window.btoa(proveResult.publicInputsJson), 'public.json', 'application/json')}
                                className={styles.downloadIconBtn}
                                style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                              >
                                ↓ Download
                              </button>
                            </div>
                          </div>
                          <pre style={{ margin: 0, padding: 12, background: '#0a0a0c', borderRadius: 6, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11, color: '#e2e8f0', border: '1px solid #1e293b', overflowX: 'auto', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                            {proveResult.publicInputsJson}
                          </pre>
                        </div>
                      </div>

                    </div>
                  )}

                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Mobile: sticky compiler output footer ── */}
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
    </div>
  );
}
