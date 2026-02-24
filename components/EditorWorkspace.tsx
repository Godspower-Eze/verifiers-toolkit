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

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type CompileState = 'idle' | 'compiling' | 'success' | 'error';
type GenerateState = 'idle' | 'generating' | 'success' | 'error';
type VerifierTab = 'verifier' | 'constants';

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
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);

  // ── Sizes — stored in refs for getValue() snapshots, synced to state for renders
  const col1WRef = useRef(420);
  const col3WRef = useRef(300);
  const outH1Ref = useRef(180);
  const outH3Ref = useRef(200);

  const [col1Width, _setCol1Width] = useState(420);
  const [col3Width, _setCol3Width] = useState(300);
  const [outputHeight1, _setOutputHeight1] = useState(180);
  const [outputHeight3, _setOutputHeight3] = useState(200);

  // Setters that keep refs in sync
  const setCol1Width = useCallback((v: number) => { col1WRef.current = v; _setCol1Width(v); }, []);
  const setCol3Width = useCallback((v: number) => { col3WRef.current = v; _setCol3Width(v); }, []);
  const setOut1 = useCallback((v: number) => { outH1Ref.current = v; _setOutputHeight1(v); }, []);
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
  const [activeTab, setActiveTab] = useState<VerifierTab>('verifier');

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
        setActiveTab('verifier');
      } else {
        setGenerateState('error');
        setGenerateError(data.error);
      }
    } catch (err) {
      setGenerateState('error');
      setGenerateError(String(err));
    }
  }, [validVk]);

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

  // ── Helpers
  const activeContent = verifier
    ? (activeTab === 'verifier' ? verifier.verifierCairo : verifier.constantsCairo)
    : '';
  const dlHref = (c: string) => `data:text/plain;charset=utf-8,${encodeURIComponent(c)}`;

  // ── Render
  return (
    <div className={styles.workspace}>

      {/* Header with template picker */}
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <span className={styles.logo}>◆</span>
          <h1 className={styles.title}>Cairo Verifier Generator</h1>
        </div>
        <p className={styles.subtitle}>Circom → Groth16 Cairo Verifier · Powered by Garaga</p>
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
      </header>

      {/* Resizable 3-column row */}
      <div className={styles.editorRow}>

        {/* ── Col 1: Circom editor (top) + compile output (bottom) ── */}
        <div className={styles.colWrap} style={{ width: col1Width, flexShrink: 0 }}>
          <div className={styles.paneLabel}>
            <span>{filename}</span>
            <span className={styles.languageBadge}>Circom 2.0</span>
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

        {/* ── Col 2: Cairo verifier — only after generation ── */}
        {verifier && (
          <div className={`${styles.colWrap} ${styles.cairoPane}`} style={{ flex: 1, minWidth: 200 }}>
            <div className={styles.tabBar}>
              {(['verifier', 'constants'] as VerifierTab[]).map((tab) => (
                <button
                  key={tab}
                  className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'verifier' ? 'groth16_verifier.cairo' : 'constants.cairo'}
                </button>
              ))}
              <a
                className={styles.downloadBtn}
                href={dlHref(activeContent)}
                download={activeTab === 'verifier' ? 'groth16_verifier.cairo' : 'groth16_verifier_constants.cairo'}
              >↓</a>
            </div>
            <pre className={styles.cairoCode}>{activeContent}</pre>
            <div className={styles.deployBar}>
              <span className={styles.deployLabel}>Deploy to Starknet</span>
              <button id="declare-btn" className={styles.declareBtn}>Declare Contract</button>
              <button id="deploy-btn" className={styles.deployBtn}>Deploy Contract</button>
            </div>
          </div>
        )}

        {/* ── Col divider: resize col3 (inverted — drag left grows col3) ── */}
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
