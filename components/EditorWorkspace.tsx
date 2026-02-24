'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
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

// ─── Drag utilities ───────────────────────────────────────────────────────────

function lockBody(cursor: string) {
  document.body.style.cursor = cursor;
  document.body.style.userSelect = 'none';
}
function unlockBody() {
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

function useHDrag(onDelta: (dx: number) => void) {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => onDelta(ev.clientX - startX);
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); unlockBody(); };
    lockBody('col-resize');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onDelta]);
}

function useVDrag(onDelta: (dy: number) => void) {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => onDelta(ev.clientY - startY);
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); unlockBody(); };
    lockBody('row-resize');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onDelta]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditorWorkspace() {
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Column widths in px (snapshotted at drag start)
  const col1SnapW = useRef(0);
  const col3SnapW = useRef(0);
  const [col1Width, setCol1Width] = useState(420);
  const [col3Width, setCol3Width] = useState(300);

  // ── Output panel heights in px
  const outH1Snap = useRef(0);
  const outH3Snap = useRef(0);
  const [outputHeight1, setOutputHeight1] = useState(180);  // col1 compile output
  const [outputHeight3, setOutputHeight3] = useState(200);  // col3 generate status

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

  // ── Reflow Monaco when col1 width changes (fixes text not reacting to drag)
  useEffect(() => {
    editorRef.current?.layout();
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

  // ── Editor markers
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

  // ── Column drag handlers
  const onDivider1 = useHDrag(useCallback((dx: number) => {
    setCol1Width(Math.max(220, Math.min(900, col1SnapW.current + dx)));
  }, []));
  const snapDivider1 = useCallback((e: React.MouseEvent) => {
    col1SnapW.current = containerRef.current
      ?.querySelector<HTMLElement>(`.${styles.editorPane}`)?.offsetWidth ?? col1Width;
    onDivider1(e);
  }, [onDivider1, col1Width]);

  const onDivider3 = useHDrag(useCallback((dx: number) => {
    setCol3Width(Math.max(220, Math.min(700, col3SnapW.current - dx)));
  }, []));
  const snapDivider3 = useCallback((e: React.MouseEvent) => {
    col3SnapW.current = containerRef.current
      ?.querySelector<HTMLElement>(`.${styles.vkPane}`)?.offsetWidth ?? col3Width;
    onDivider3(e);
  }, [onDivider3, col3Width]);

  // ── Row drag handlers
  const onRowDrag1 = useVDrag(useCallback((dy: number) => {
    setOutputHeight1(Math.max(60, Math.min(500, outH1Snap.current - dy)));
  }, []));
  const snapRow1 = useCallback((e: React.MouseEvent) => {
    outH1Snap.current = outputHeight1;
    onRowDrag1(e);
  }, [onRowDrag1, outputHeight1]);

  const onRowDrag3 = useVDrag(useCallback((dy: number) => {
    setOutputHeight3(Math.max(60, Math.min(500, outH3Snap.current - dy)));
  }, []));
  const snapRow3 = useCallback((e: React.MouseEvent) => {
    outH3Snap.current = outputHeight3;
    onRowDrag3(e);
  }, [onRowDrag3, outputHeight3]);

  // ── Helpers
  const activeContent = verifier
    ? (activeTab === 'verifier' ? verifier.verifierCairo : verifier.constantsCairo)
    : '';
  const downloadHref = (c: string) => `data:text/plain;charset=utf-8,${encodeURIComponent(c)}`;

  // ── Render
  return (
    <div className={styles.workspace}>

      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <span className={styles.logo}>◆</span>
          <h1 className={styles.title}>Cairo Verifier Generator</h1>
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
          {templates.find((t) => t.id === selectedId) && (
            <span className={styles.templateDescription}>
              {templates.find((t) => t.id === selectedId)!.description}
            </span>
          )}
        </div>
      </header>

      {/* ── Resizable editor row ── */}
      <div className={styles.editorRow} ref={containerRef}>

        {/* ── Col 1: Circom editor + compile output ── */}
        <div className={styles.editorPane} style={{ width: col1Width }}>
          <div className={styles.paneLabel}>
            <span>{filename}</span>
            <span className={styles.languageBadge}>Circom 2.0</span>
          </div>

          {/* Monaco fills the remaining space */}
          <div style={{ flex: 1, minHeight: 0 }}>
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

          {/* Row drag handle */}
          <div className={styles.rowDivider} onMouseDown={snapRow1} />

          {/* Compile output + button */}
          <div className={styles.outputPanel} style={{ height: outputHeight1 }}>
            <div className={styles.paneLabelSmall}>
              <span>Compile Output</span>
              <button
                id="compile-btn"
                className={`${styles.compileBtn} ${styles[compileState]}`}
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
                  <table className={styles.statsTable}>
                    <tbody>
                      <tr>
                        <td>Non-linear constraints</td>
                        <td><strong>{(compileResult.result as { constraintCount: number }).constraintCount}</strong></td>
                      </tr>
                      {(compileResult.result as { wireCount?: number }).wireCount !== undefined && (
                        <tr>
                          <td>Wires</td>
                          <td><strong>{(compileResult.result as { wireCount?: number }).wireCount}</strong></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {(compileResult.result as { warnings: string[] }).warnings.length > 0 && (
                    <div className={styles.warningsList}>
                      <strong>Warnings:</strong>
                      <ul>{(compileResult.result as { warnings: string[] }).warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    </div>
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

        {/* ── Cairo pane (col 2) — only shown after generation ── */}
        {verifier && (
          <>
            <div className={styles.colDivider} />

            <div className={styles.cairoPane}>
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
                  href={downloadHref(activeContent)}
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
          </>
        )}

        {/* ── Col divider before VK pane ── */}
        <div className={styles.colDivider} onMouseDown={snapDivider3} />

        {/* ── Col 3: VK panel + generate output ── */}
        <div className={styles.vkPane} style={{ width: col3Width }}>
          <div className={styles.paneLabelSmall}>Verification Key</div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <VkPanel
              onValidVk={(vk) => setValidVk(vk)}
              onClearVk={() => { setValidVk(null); setVerifier(null); setGenerateState('idle'); }}
            />
          </div>

          {/* Row drag within col3 */}
          <div className={styles.rowDivider} onMouseDown={snapRow3} />

          {/* Generate status + button */}
          <div className={styles.outputPanel} style={{ height: outputHeight3 }}>
            <div className={styles.paneLabelSmall}>
              <span>Verifier</span>
              {validVk && (
                <button
                  id="generate-btn"
                  className={`${styles.generateBtn} ${generateState === 'generating' ? styles.generating : ''}`}
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
              {generateState === 'idle' && !validVk && (
                <p className={styles.outputHint}>Upload a VK to generate a Cairo verifier.</p>
              )}
              {generateState === 'idle' && validVk && (
                <p className={styles.outputHint}>VK validated. Click ⬡ Generate to build the Cairo verifier.</p>
              )}
              {generateState === 'generating' && (
                <p className={styles.outputHint}><span className={styles.spinner} /> Generating Cairo verifier…</p>
              )}
              {generateState === 'error' && (
                <div className={styles.errorList}>
                  <div className={styles.errorHeader}>✗ Generation failed</div>
                  <div className={styles.errorItem}>
                    <span className={styles.errorMessage}>{generateError}</span>
                  </div>
                </div>
              )}
              {generateState === 'success' && verifier && (
                <div className={styles.successBlock}>
                  <div className={styles.successHeader}>✓ Verifier generated</div>
                  <table className={styles.statsTable}>
                    <tbody>
                      <tr><td>Project</td><td><strong>{verifier.projectName}</strong></td></tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
