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

// Monaco is SSR-incompatible — dynamic import with ssr:false is required
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

type CompileState = 'idle' | 'compiling' | 'success' | 'error';
type GenerateState = 'idle' | 'generating' | 'success' | 'error';
type VerifierTab = 'verifier' | 'constants' | 'lib' | 'scarb';

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
  const [generateState, setGenerateState] = useState<GenerateState>('idle');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [verifier, setVerifier] = useState<GeneratedVerifier | null>(null);
  const [activeTab, setActiveTab] = useState<VerifierTab>('verifier');

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

  // ── Generate Verifier ──────────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────────────────────
  // Derived helpers
  // ──────────────────────────────────────────────────────────────────────────

  const TABS: { id: VerifierTab; label: string }[] = [
    { id: 'verifier', label: 'groth16_verifier.cairo' },
    { id: 'constants', label: 'groth16_verifier_constants.cairo' },
    { id: 'lib', label: 'lib.cairo' },
    { id: 'scarb', label: 'Scarb.toml' },
  ];

  function activeTabContent(): string {
    if (!verifier) return '';
    switch (activeTab) {
      case 'verifier':   return verifier.verifierCairo;
      case 'constants':  return verifier.constantsCairo;
      case 'lib':        return verifier.libCairo;
      case 'scarb':      return verifier.scarbToml;
    }
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

        <div className={styles.toolbarActions}>
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

          {validVk && (
            <button
              id="generate-btn"
              className={`${styles.generateBtn} ${generateState === 'generating' ? styles.generating : ''}`}
              onClick={handleGenerate}
              disabled={generateState === 'generating'}
            >
              {generateState === 'generating' ? (
                <><span className={styles.spinner} /> Generating…</>
              ) : (
                '⬡ Generate Verifier'
              )}
            </button>
          )}
        </div>
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
          {/* Compile output */}
          <div className={styles.paneLabel}>Output</div>
          <div className={styles.outputContent}>
            {compileState === 'idle' && !verifier && (
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

          {/* VK panel */}
          <VkPanel
            onValidVk={(vk) => setValidVk(vk)}
            onClearVk={() => { setValidVk(null); setVerifier(null); setGenerateState('idle'); }}
          />

          {/* Generated verifier output */}
          {(generateState !== 'idle' || verifier) && (
            <div className={styles.verifierPane}>
              <div className={styles.verifierHeader}>
                {generateState === 'generating' && (
                  <span className={styles.generatingHint}><span className={styles.spinner} /> Generating Cairo verifier…</span>
                )}
                {generateState === 'error' && (
                  <span className={styles.generateError}>✗ {generateError}</span>
                )}
                {generateState === 'success' && verifier && (
                  <>
                    <span className={styles.generateSuccess}>✓ Verifier generated</span>
                    <span className={styles.projectName}>{verifier.projectName}</span>
                  </>
                )}
              </div>

              {verifier && (
                <>
                  {/* File tabs */}
                  <div className={styles.tabBar}>
                    {TABS.map((tab) => (
                      <button
                        key={tab.id}
                        className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* File content */}
                  <pre className={styles.cairoOutput}>{activeTabContent()}</pre>

                  {/* Download buttons */}
                  <div className={styles.downloadRow}>
                    {TABS.map((tab) => {
                      const content = tab.id === 'verifier' ? verifier.verifierCairo
                        : tab.id === 'constants' ? verifier.constantsCairo
                        : tab.id === 'lib' ? verifier.libCairo
                        : verifier.scarbToml;
                      const ext = tab.id === 'scarb' ? '' : '';
                      const fileName = tab.id === 'scarb' ? 'Scarb.toml'
                        : tab.id === 'lib' ? 'lib.cairo'
                        : tab.id === 'constants' ? 'groth16_verifier_constants.cairo'
                        : 'groth16_verifier.cairo';
                      return (
                        <a
                          key={tab.id}
                          className={styles.downloadBtn}
                          href={`data:text/plain;charset=utf-8,${encodeURIComponent(content)}`}
                          download={fileName}
                        >
                          ↓ {fileName}
                        </a>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
