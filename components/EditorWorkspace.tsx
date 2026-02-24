'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as MonacoNS from 'monaco-editor';
import type { CircuitTemplate } from '@/lib/circom/circuitTemplates';
import type { CompileError, CompileResponse } from '@/lib/circom/types';
import type { SnarkJsVk } from '@/lib/vk/types';
import VkPanel from './VkPanel';
import styles from './EditorWorkspace.module.css';

// Monaco is SSR-incompatible — dynamic import with ssr:false is required
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

type CompileState = 'idle' | 'compiling' | 'success' | 'error';

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditorWorkspace() {
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);

  const [templates, setTemplates] = useState<CircuitTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [filename, setFilename] = useState<string>('circuit.circom');
  const [compileState, setCompileState] = useState<CompileState>('idle');
  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null);
  const [validVk, setValidVk] = useState<SnarkJsVk | null>(null);

  // ── Load templates ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data: CircuitTemplate[]) => {
        setTemplates(data);
        if (data.length > 0) {
          applyTemplate(data[0]);
        }
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Apply a template ───────────────────────────────────────────────────────
  const applyTemplate = useCallback((t: CircuitTemplate) => {
    setSelectedId(t.id);
    setCode(t.code);
    setFilename(t.filename);
    setCompileResult(null);
    setCompileState('idle');
    clearEditorMarkers();
  }, []);

  // ── Compile ────────────────────────────────────────────────────────────────
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

      if (!result.success) {
        applyEditorMarkers(result.errors);
      }
    } catch (err) {
      console.error('Compile request failed:', err);
      setCompileState('error');
    }
  }, [code, filename]);

  // ── Editor markers (error squiggles) ───────────────────────────────────────
  function clearEditorMarkers() {
    if (!editorRef.current || !monacoRef.current) return;
    monacoRef.current.editor.setModelMarkers(
      editorRef.current.getModel()!,
      'circom-compiler',
      []
    );
  }

  function applyEditorMarkers(errors: CompileError[]) {
    if (!editorRef.current || !monacoRef.current) return;
    const monaco = monacoRef.current;
    const markers: MonacoNS.editor.IMarkerData[] = errors.map((e) => ({
      severity: monaco.MarkerSeverity.Error,
      message: e.message,
      startLineNumber: e.line ?? 1,
      startColumn: e.column ?? 1,
      endLineNumber: e.line ?? 1,
      endColumn: (e.column ?? 1) + 10,
    }));
    monaco.editor.setModelMarkers(editorRef.current.getModel()!, 'circom-compiler', markers);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.workspace}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <span className={styles.logo}>◆</span>
          <h1 className={styles.title}>Cairo Verifier Generator</h1>
        </div>
        <p className={styles.subtitle}>
          Compile Circom → generate Cairo / Groth16 verifiers via Garaga
        </p>
      </header>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
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
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {templates.find((t) => t.id === selectedId) && (
            <span className={styles.templateDescription}>
              {templates.find((t) => t.id === selectedId)!.description}
            </span>
          )}
        </div>

        <button
          id="compile-btn"
          className={`${styles.compileBtn} ${styles[compileState]}`}
          onClick={handleCompile}
          disabled={compileState === 'compiling'}
        >
          {compileState === 'compiling' ? (
            <><span className={styles.spinner} /> Compiling…</>
          ) : (
            '▶ Compile'
          )}
        </button>
      </div>

      {/* ── Editor + Output split ── */}
      <div className={styles.editorRow}>
        {/* Editor pane */}
        <div className={styles.editorPane}>
          <div className={styles.paneLabel}>
            <span>{filename}</span>
            <span className={styles.languageBadge}>Circom 2.0</span>
          </div>
          <MonacoEditor
            height="100%"
            defaultLanguage="rust"   // closest built-in grammar to Circom
            theme="vs-dark"
            value={code}
            onChange={(v) => setCode(v ?? '')}
            options={{
              fontSize: 14,
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

        {/* Output pane */}
        <div className={styles.outputPane}>
          <div className={styles.paneLabel}>Output</div>
          <div className={styles.outputContent}>
            {/* compile output ... */}
            {compileState === 'idle' && (
              <p className={styles.outputHint}>Click ▶ Compile to run the circuit.</p>
            )}
            {compileState === 'compiling' && (
              <p className={styles.outputHint}>Compiling…</p>
            )}
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
                    <ul>
                      {(compileResult.result as { warnings: string[] }).warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
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
                    {e.line && (
                      <span className={styles.errorLocation}>line {e.line}{e.column ? `:${e.column}` : ''}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <VkPanel
            onValidVk={(vk) => setValidVk(vk)}
            onClearVk={() => setValidVk(null)}
          />
        </div>
      </div>
    </div>
  );
}
