'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as MonacoNS from 'monaco-editor';
import type { CircuitTemplate } from '@/lib/circom/circomTemplates';
import type { CompileError, CompileResponse, CompileSuccessResponse, CircomCompileResult, NoirCompileResult, LanguageId } from '@/lib/circom/types';
import { parseSymInputSignals, parseCircomInputSignals } from '@/lib/circom/parseInputSignals';
import { parseNoirInputs } from '@/lib/noir/parseNoirInputs';
import styles from './EditorWorkspace.module.css';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });


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

  // ── Circuit state — multi-file
  const [language, setLanguage] = useState<LanguageId>('circom');
  const languageRef = useRef<LanguageId>('circom');
  const [templates, setTemplates] = useState<CircuitTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  // Refs so the compile-success useEffect can read latest values without being
  // re-triggered by every template/selection change.
  const templatesRef = useRef<CircuitTemplate[]>([]);
  const selectedIdRef = useRef('');
  const [fileTabs, setFileTabs] = useState<{ id: string; filename: string }[]>([]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [activeFileId, setActiveFileId] = useState('');
  const [entrypoint, setEntrypoint] = useState('circuit.circom');
  // Adding-file inline input state
  const [addingFile, setAddingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
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
  const [copiedCalldata, setCopiedCalldata] = useState(false);

  // ── Noir Calldata state
  const [noirCalldataState, setNoirCalldataState] = useState<CompileState>('idle');
  const [noirCalldataResult, setNoirCalldataResult] = useState<string[] | null>(null);

  // ── Circom Calldata state
  const [circomCalldataState, setCircomCalldataState] = useState<CompileState>('idle');
  const [circomCalldataResult, setCircomCalldataResult] = useState<string[] | null>(null);
  const [copiedCircomCalldata, setCopiedCircomCalldata] = useState(false);

  // ── Derived availability
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

  // ── Auto-populate signal inputs from entrypoint source on successful compilation
  useEffect(() => {
    if (compileState !== 'success') return;

    const activeTemplate = templatesRef.current.find((t) => t.id === selectedIdRef.current);
    let signals: Record<string, unknown> = {};

    if (languageRef.current === 'noir') {
      // Noir: use the ABI from the compiled artifact for authoritative input inference
      const noirResult = compileResult?.success
        ? ((compileResult as CompileSuccessResponse).result as NoirCompileResult)
        : undefined;
      if (noirResult?.abi) {
        signals = parseNoirInputs(noirResult.abi) as Record<string, unknown>;
      }
      // For Noir there is no Setup step — go straight to Prove tab
      setRightTab('prove');
    } else {
      // Circom: prefer sym-based parsing (handles template arrays, comma-separated decls)
      const entrypointContent = fileContents[entrypoint] ?? '';
      const symContent = compileResult?.success
        ? ((compileResult as CompileSuccessResponse).result as CircomCompileResult).symContent
        : undefined;

      let circomSignals = symContent
        ? parseSymInputSignals(symContent, entrypointContent)
        : parseCircomInputSignals(entrypointContent);

      // If sym parsing returned nothing (malformed sym), fall back to regex
      if (symContent && Object.keys(circomSignals).length === 0) {
        circomSignals = parseCircomInputSignals(entrypointContent);
      }
      signals = circomSignals as Record<string, unknown>;
      setRightTab('setup');
    }

    // Overlay pre-computed valid defaults from the active template.
    // Inference gives the correct structure (names + array sizes);
    // defaultInputs supplies real values so the first proof attempt succeeds.
    if (activeTemplate?.defaultInputs) {
      const defaults = activeTemplate.defaultInputs;
      for (const key of Object.keys(signals)) {
        if (Object.prototype.hasOwnProperty.call(defaults, key)) {
          signals[key] = defaults[key];
        }
      }
    }

    if (Object.keys(signals).length > 0) {
      setSignalsInput(JSON.stringify(signals, null, 2));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compileState]);

  // ── Templates
  useEffect(() => {
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data: CircuitTemplate[]) => {
        setTemplates(data);
        templatesRef.current = data;
        if (data.length > 0) applyTemplate(data[0]);
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTemplate = useCallback((t: CircuitTemplate) => {
    setSelectedId(t.id);
    selectedIdRef.current = t.id;
    setLanguage(t.language);
    languageRef.current = t.language;
    const tabs = t.files.map((f) => ({ id: f.filename, filename: f.filename }));
    const contents: Record<string, string> = {};
    for (const f of t.files) contents[f.filename] = f.content;
    setFileTabs(tabs);
    setFileContents(contents);
    setActiveFileId(t.entrypoint);
    setEntrypoint(t.entrypoint);
    setCompileResult(null);
    setCompileState('idle');
    setSetupState('idle');
    setSetupResult(null);
    setVkState('idle');
    setProveState('idle');
    setProveResult(null);
    clearEditorMarkers();
  }, []);

  const handleAddFile = useCallback(() => {
    setAddingFile(true);
    setNewFileName('');
  }, []);

  const commitAddFile = useCallback(() => {
    const name = newFileName.trim();
    if (!name) { setAddingFile(false); return; }
    const ext = languageRef.current === 'noir' ? '.nr' : '.circom';
    const filename = name.endsWith(ext) ? name : `${name}${ext}`;
    if (fileTabs.some((t) => t.filename === filename)) { setAddingFile(false); return; }
    const defaultContent = languageRef.current === 'noir' ? `// ${filename}\n` : `pragma circom 2.0.0;\n`;
    setFileTabs((prev) => [...prev, { id: filename, filename }]);
    setFileContents((prev) => ({ ...prev, [filename]: defaultContent }));
    setActiveFileId(filename);
    setAddingFile(false);
  }, [newFileName, fileTabs]);

  const handleDeleteFile = useCallback((id: string) => {
    setFileTabs((prev) => prev.filter((t) => t.id !== id));
    setFileContents((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setActiveFileId((cur) => (cur === id ? entrypoint : cur));
  }, [entrypoint]);

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

    // Reset downstream states to prevent stale data persistence
    setSetupState('idle');
    setSetupResult(null);
    setVkState('idle');
    setProveState('idle');
    setProveResult(null);

    try {
      const resp = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: fileTabs.map((tab) => ({ filename: tab.filename, content: fileContents[tab.id] ?? '' })),
          entrypoint,
          language,
        }),
      });
      const result: CompileResponse = await resp.json();
      setCompileResult(result);
      setCompileState(result.success ? 'success' : 'error');
      if (!result.success) applyEditorMarkers(result.errors);
    } catch (err) {
      console.error('Compile failed:', err);
      setCompileState('error');
    }
  }, [fileTabs, fileContents, entrypoint]);

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
  const handleGenerateNoirCalldata = useCallback(async () => {
    if (!proveResult?.success || !proveResult?.isNoir) return;
    setNoirCalldataState('compiling');
    setNoirCalldataResult(null);

    try {
      const resp = await fetch('/api/circuit/noir/calldata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proofBase64: proveResult.proofBase64,
          publicInputsBase64: proveResult.publicInputsBase64,
          vkBase64: proveResult.vkBase64,
        }),
      });
      const result = await resp.json();
      if (result.success) {
        setNoirCalldataResult(result.calldata);
        setNoirCalldataState('success');
      } else {
        setNoirCalldataState('error');
      }
    } catch (err) {
      console.error('Calldata generation failed:', err);
      setNoirCalldataState('error');
    }
  }, [proveResult]);

  const handleGenerateCircomCalldata = useCallback(async () => {
    if (!proveResult?.success || proveResult?.isNoir) return;
    setCircomCalldataState('compiling');
    setCircomCalldataResult(null);

    try {
      const resp = await fetch('/api/circuit/groth16/calldata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proofJson: JSON.parse(proveResult.proofJson),
          publicInputsJson: JSON.parse(proveResult.publicInputsJson),
          vkJson: JSON.parse(setupResult?.vkJson ?? '{}'),
        }),
      });
      const result = await resp.json();
      if (result.success) {
        setCircomCalldataResult(result.calldata);
        setCircomCalldataState('success');
      } else {
        setCircomCalldataState('error');
      }
    } catch (err) {
      console.error('Circom calldata generation failed:', err);
      setCircomCalldataState('error');
    }
  }, [proveResult, setupResult]);

  const handleProve = useCallback(async () => {
    if (language === 'noir') {
      setProveState('compiling');
      setProveResult(null);

      try {
        let parsedInputs: Record<string, unknown>;
        try {
          parsedInputs = JSON.parse(signalsInput);
        } catch (e) {
          throw new Error("Invalid Inputs JSON format.");
        }

        const resp = await fetch('/api/circuit/prove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: 'noir',
            files: fileTabs.map((tab) => ({ filename: tab.filename, content: fileContents[tab.id] ?? '' })),
            entrypoint,
            inputs: parsedInputs,
          }),
        });
        const result = await resp.json();
        setProveResult({ ...result, isNoir: true });
        setProveState(result.success ? 'success' : 'error');
      } catch (err: unknown) {
        console.error('Proving failed:', err);
        setProveResult({ success: false, error: err instanceof Error ? err.message : String(err) });
        setProveState('error');
      }
      return;
    }

    const wasmBase64 = (compileResult as any)?.result?.wasmBase64;
    const zkeyBase64 = setupResult?.zkeyBase64;

    if (!wasmBase64 || !zkeyBase64) return;

    setProveState('compiling');
    setProveResult(null);
    setCircomCalldataState('idle');
    setCircomCalldataResult(null);

    try {
      let parsedSignals: unknown;
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
    } catch (err: unknown) {
      console.error('Proving failed:', err);
      setProveResult({ success: false, error: err instanceof Error ? err.message : String(err) });
      setProveState('error');
    }
  }, [language, compileResult, setupResult, signalsInput, fileTabs, fileContents, entrypoint]);

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
  const baseName = entrypoint.replace('.circom', '');
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
                <span>Circuit</span>
                <div className={styles.langSwitcher}>
                  <button
                    className={language === 'circom' ? styles.langActive : styles.langInactive}
                    onClick={() => {
                      const first = templatesRef.current.find((t) => t.language === 'circom');
                      if (first) applyTemplate(first);
                    }}
                  >
                    Circom 2.0
                  </button>
                  <button
                    className={language === 'noir' ? styles.langActive : styles.langInactive}
                    onClick={() => {
                      const first = templatesRef.current.find((t) => t.language === 'noir');
                      if (first) applyTemplate(first);
                    }}
                  >
                    Noir
                  </button>
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
                {templates
                  .filter((t) => t.language === language)
                  .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          {/* File tabs */}
          <div style={{ display: 'flex', alignItems: 'center', background: '#111114', borderBottom: '1px solid #222', overflowX: 'auto', flexShrink: 0 }}>
            {fileTabs.map((tab) => (
              <div
                key={tab.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  background: activeFileId === tab.id ? '#0a0a0c' : 'transparent',
                  borderRight: '1px solid #222',
                  borderBottom: activeFileId === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: activeFileId === tab.id ? '#f8fafc' : '#94a3b8',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                }}
                onClick={() => setActiveFileId(tab.id)}
              >
                <span>{tab.filename}</span>
                {tab.filename === entrypoint && (
                  <span style={{ fontSize: 10, color: '#3b82f6', padding: '1px 4px', background: 'rgba(59,130,246,0.1)', borderRadius: 3 }}>entry</span>
                )}
                {tab.filename !== entrypoint && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteFile(tab.id); }}
                    style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                    title="Remove file"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {addingFile ? (
              <div style={{ display: 'flex', alignItems: 'center', margin: '4px 8px', background: '#1e293b', border: '1px solid #3b82f6', borderRadius: 4, overflow: 'hidden' }}>
                <input
                  autoFocus
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitAddFile(); if (e.key === 'Escape') setAddingFile(false); }}
                  onBlur={commitAddFile}
                  placeholder="filename"
                  style={{ padding: '2px 4px 2px 6px', background: 'transparent', border: 'none', color: '#f8fafc', fontSize: 12, width: 100, outline: 'none' }}
                />
                <span style={{ color: '#64748b', fontSize: 12, paddingRight: 6, userSelect: 'none', flexShrink: 0 }}>{language === 'noir' ? '.nr' : '.circom'}</span>
              </div>
            ) : (
              <button
                onClick={handleAddFile}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, padding: '4px 12px', lineHeight: 1 }}
                title="Add file"
              >
                +
              </button>
            )}
          </div>

          {/* Monaco fills remaining height */}
          <div className={styles.monacoWrap} style={{ flex: 1, minHeight: 0 }}>
            <MonacoEditor
              height="100%"
              defaultLanguage="rust"
              theme="vs-dark"
              value={fileContents[activeFileId] ?? ''}
              onChange={(v) => {
                const val = v ?? '';
                setFileContents((prev) => ({ ...prev, [activeFileId]: val }));
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
{compileState === 'idle' && <p className={styles.outputHint}>Click <b>▶ Compile Circuit</b> to compile your <b>{language === 'noir' ? '.nr' : '.circom'}</b> code.</p>}
            {compileState === 'compiling' && <p className={styles.outputHint}>Compiling constraints and generating WebAssembly witness calculator…</p>}

            {compileState === 'success' && compileResult?.success && (
              <div className={styles.successBlock} style={{ fontSize: 13, padding: 16 }}>
                <div style={{ color: '#10b981', marginBottom: 8, fontWeight: 600 }}>✓ Circuit Compiled Successfully</div>
                  <table className={styles.statsTable} style={{ marginBottom: 12 }}>
                    <tbody>
                      {language === 'noir' ? (
                        <>
                          <tr>
                            <td style={{ paddingRight: 32, paddingBottom: 4 }}>System</td>
                            <td style={{ paddingBottom: 4 }}><strong>UltraHonk</strong></td>
                          </tr>
                          <tr>
                            <td style={{ paddingRight: 32, paddingBottom: 4 }}>Trusted Setup</td>
                            <td style={{ paddingBottom: 4 }}><strong style={{ color: '#10b981' }}>None (Transparent)</strong></td>
                          </tr>
                          {(compileResult.result as any).gateCount !== undefined && (
                            <>
                              <tr>
                                <td style={{ paddingRight: 32, paddingBottom: 4 }}>Circuit Size</td>
                                <td style={{ paddingBottom: 4 }}><strong>{(compileResult.result as any).gateCount.toLocaleString()}</strong></td>
                              </tr>
                              {(compileResult.result as any).acirOpcodeCount !== undefined && (compileResult.result as any).acirOpcodeCount > 0 && (
                                <tr>
                                  <td style={{ paddingRight: 32 }}>ACIR Opcodes</td>
                                  <td><strong>{(compileResult.result as any).acirOpcodeCount.toLocaleString()}</strong></td>
                                </tr>
                              )}
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <tr>
                            <td style={{ paddingRight: 32, paddingBottom: 4 }}>System</td>
                            <td style={{ paddingBottom: 4 }}><strong>Groth16</strong></td>
                          </tr>
                          <tr>
                            <td style={{ paddingRight: 32, paddingBottom: 4 }}>Trusted Setup</td>
                            <td style={{ paddingBottom: 4 }}><strong style={{ color: '#f59e0b' }}>Required (Phase 2)</strong></td>
                          </tr>
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
                        </>
                      )}
                    </tbody>
                  </table>
                {(compileResult.result as any).warnings?.length > 0 && (
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
      <div className={`${styles.colWrap} ${styles.rightColWrap}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {compileState !== 'success' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13, background: '#0a0a0c' }}>
            <p>Compiled artifacts will appear here.</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

            {/* Tab bar — Setup is hidden for Noir (no trusted setup needed) */}
            <div style={{ display: 'flex', gap: 32, borderBottom: '1px solid #222', padding: '0 24px', background: '#0a0a0c' }}>
              {language === 'circom' && (
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
              )}
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
                          <span style={{ color: '#10b981', fontSize: 13, fontWeight: 500 }}>{r1csName} from compilation</span>
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
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #222', flexWrap: 'wrap', gap: 8 }}>
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
                      <pre style={{ margin: 0, padding: 16, background: '#0a0a0c', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', border: '1px solid #1e293b', overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
                        {(() => {
                          try { return JSON.stringify(JSON.parse(setupResult.vkJson), null, 2); }
                          catch(e) { return setupResult.vkJson; }
                        })()}
                      </pre>
                      
                      <div style={{ marginTop: 20, textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => {
                            localStorage.setItem('cairo_verifier_generator_pending_vk', setupResult.vkJson);
                            localStorage.setItem('cairo_verifier_generator_pending_vk_format', 'circom');
                            window.dispatchEvent(new CustomEvent('pending-vk-updated', { detail: { format: 'circom' } }));
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

                  {language === 'circom' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                      {/* WASM status (Circom only) */}
                      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #222', borderRadius: 8, padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontSize: 13 }}>✓</span>
                          <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{wasmName} from compilation</span>
                        </div>
                        <p style={{ margin: 0, paddingLeft: 30, color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                          The compiled WebAssembly executable representation of your circuit constraints.
                          It is used by the prover to calculate the final <strong>witness</strong> vectors (intermediate signals) from your private inputs.
                        </p>
                      </div>

                      {/* ZKey status (Circom only) */}
                      <div style={{ background: hasZkey ? 'rgba(16, 185, 129, 0.02)' : 'rgba(255,255,255,0.02)', border: hasZkey ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid #333', borderRadius: 8, padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: hasZkey ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.05)', color: hasZkey ? '#10b981' : '#64748b', fontSize: 13 }}>{hasZkey ? '✓' : '✗'}</span>
                          <span style={{ color: hasZkey ? '#e2e8f0' : '#a1a1aa', fontSize: 14, fontWeight: 600 }}>
                            {hasZkey ? 'ZKey from Setup' : 'Run Setup to generate ZKey'}
                          </span>
                        </div>
                        <p style={{ margin: 0, paddingLeft: 30, color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                          The cryptographic <strong>Proving Key</strong> generated exclusively during the Trusted Setup phase.
                          It contains the specific cryptographic parameters required to mathematically prove knowledge of the calculated witness.
                        </p>
                      </div>
                    </div>
                  )}

                  {language === 'noir' && (
                    <div style={{ marginBottom: 24, padding: 16, background: 'rgba(6, 182, 212, 0.04)', border: '1px solid rgba(6, 182, 212, 0.15)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ color: '#06b6d4', fontSize: 13 }}>✓</span>
                        <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>UltraHonk — No Trusted Setup Required</span>
                      </div>
                      <p style={{ margin: 0, paddingLeft: 22, color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                        Noir uses the <strong>UltraHonk</strong> proof system — a transparent scheme with no circuit-specific trusted setup (no ptau or ZKey files).
                        Proofs are generated directly from the ACIR bytecode + your witness inputs.
                      </p>
                    </div>
                  )}

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
                      disabled={proveState === 'compiling' || (language === 'circom' && !hasZkey)}
                      style={{ width: '100%', padding: '14px 16px', fontSize: 13, borderRadius: 8, fontWeight: 600, transition: 'all 0.2s' }}
                    >
                      {proveState === 'compiling'
                        ? <><span className={styles.spinner} style={{ marginRight: 8 }} />Computing Witness &amp; Generating Proof…</>
                        : language === 'noir'
                          ? 'Generate Noir Proof'
                          : 'Create Proof'}
                    </button>
                  </div>

                  {/* Prove error */}
                  {proveState === 'error' && (
                    <div className={styles.errorList} style={{ marginTop: 16, padding: 16 }}>
                      <div className={styles.errorHeader}>✗ Proving failed</div>
                      <div className={styles.errorItem}>
                        <span className={styles.errorMessage}>{proveResult?.error || (language === 'noir' ? 'An unknown error occurred during Noir proof generation.' : 'An unknown error occurred during Groth16 proof generation. Check your inputs against the constraints.')}</span>
                      </div>
                    </div>
                  )}

                  {/* Prove success */}
                  {proveState === 'success' && proveResult?.success && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out', borderTop: '1px solid #222', paddingTop: 24 }}>
                       
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        {proveResult.isNoir ? (
                          <>
                            {/* Noir: Proof (Base64) */}
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                                <span className={styles.paneLabelSmall} style={{ color: '#10b981', fontSize: 14 }}>Proof (Base64)</span>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(proveResult.proofBase64);
                                      setCopiedProof(true);
                                      setTimeout(() => setCopiedProof(false), 2000);
                                    }}
                                    className={styles.downloadIconBtn}
                                    style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                                  >
                                    {copiedProof ? <span style={{ color: '#10b981' }}>✓ Copied</span> : 'Copy'}
                                  </button>
                                  <button
                                    onClick={() => handleDownload(proveResult.proofBase64, 'proof', 'application/octet-stream')}
                                    className={styles.downloadIconBtn}
                                    style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                                  >
                                    ↓ Download
                                  </button>
                                </div>
                              </div>
                              <div style={{ maxWidth: '100%', overflowX: 'auto', background: '#0a0a0c', borderRadius: 6, border: '1px solid #1e293b', padding: 8 }}>
                                <code style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 10, color: '#e2e8f0', wordBreak: 'break-all' }}>
                                  {proveResult.proofBase64}
                                </code>
                              </div>
                            </div>

                            {/* Noir: Public Inputs (parsed) */}
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                                <span className={styles.paneLabelSmall} style={{ color: '#10b981', fontSize: 14 }}>Public Inputs</span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(proveResult.publicInputsBase64);
                                    setCopiedPublic(true);
                                    setTimeout(() => setCopiedPublic(false), 2000);
                                  }}
                                  className={styles.downloadIconBtn}
                                  style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                                >
                                  {copiedPublic ? <span style={{ color: '#10b981' }}>✓ Copied</span> : 'Copy Base64'}
                                </button>
                              </div>
                              <div style={{ background: '#0a0a0c', borderRadius: 6, border: '1px solid #1e293b', padding: 12, overflow: 'hidden' }}>
                                {(() => {
                                  try {
                                    const pubInputs = [];
                                    const buf = Buffer.from(proveResult.publicInputsBase64, 'base64');
                                    for (let i = 0; i < buf.length; i += 32) {
                                      const slice = buf.slice(i, i + 32);
                                      const num = BigInt('0x' + slice.toString('hex'));
                                      pubInputs.push(num.toString());
                                    }
                                    return pubInputs.map((val, idx) => (
                                      <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 4, minWidth: 0 }}>
                                        <span style={{ color: '#64748b', fontSize: 11, minWidth: 20, flexShrink: 0 }}>{idx + 1}.</span>
                                        <code style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11, color: '#e2e8f0', wordBreak: 'break-all', minWidth: 0 }}>{val}</code>
                                      </div>
                                    ));
                                  } catch {
                                    return (
                                      <code style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 10, color: '#e2e8f0', wordBreak: 'break-all' }}>
                                        {proveResult.publicInputsBase64}
                                      </code>
                                    );
                                  }
                                })()}
                              </div>
                            </div>

                             {/* Noir: Verification Key (Base64) */}
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                                <span className={styles.paneLabelSmall} style={{ color: '#10b981', fontSize: 14 }}>Verification Key (Base64)</span>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(proveResult.vkBase64);
                                    }}
                                    className={styles.downloadIconBtn}
                                    style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                                  >
                                    Copy
                                  </button>
                                  <button
                                    onClick={() => handleDownload(proveResult.vkBase64, 'vk', 'application/octet-stream')}
                                    className={styles.downloadIconBtn}
                                    style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                                  >
                                    ↓ Download
                                  </button>
                                </div>
                              </div>
                              <div style={{ maxWidth: '100%', overflowX: 'auto', background: '#0a0a0c', borderRadius: 6, border: '1px solid #1e293b', padding: 8 }}>
                                <code style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 10, color: '#e2e8f0', wordBreak: 'break-all' }}>
                                  {proveResult.vkBase64}
                                </code>
                              </div>
                            </div>

                            {/* Noir: Calldata Generation */}
                            <div style={{ flex: 1, marginTop: 12 }}>
                              <button
                                onClick={handleGenerateNoirCalldata}
                                disabled={noirCalldataState === 'compiling'}
                                className={`${styles.compileBtn} ${styles[noirCalldataState]}`}
                                style={{ width: '100%', padding: '12px 16px', fontSize: 13, borderRadius: 8, fontWeight: 600, background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.3)', color: '#06b6d4' }}
                              >
                                {noirCalldataState === 'compiling' ? <><span className={styles.spinner} style={{ marginRight: 8 }} />Generating Calldata…</> : 'Generate Noir Calldata'}
                              </button>

                              {noirCalldataState === 'success' && noirCalldataResult && (
                                <div style={{ marginTop: 16, animation: 'fadeIn 0.3s ease-out' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                                    <span className={styles.paneLabelSmall} style={{ color: '#06b6d4', fontSize: 14 }}>On-chain Calldata (Array)</span>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(JSON.stringify(noirCalldataResult));
                                        setCopiedCalldata(true);
                                        setTimeout(() => setCopiedCalldata(false), 2000);
                                      }}
                                      className={styles.downloadIconBtn}
                                      style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                                    >
                                      {copiedCalldata ? <span style={{ color: '#10b981' }}>✓ Copied</span> : 'Copy Array'}
                                    </button>
                                  </div>
                                  <div style={{ background: '#0a0a0c', borderRadius: 6, border: '1px solid #1e293b', padding: 12, maxHeight: 200, overflowY: 'auto' }}>
                                    {noirCalldataResult.map((val, idx) => (
                                      <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                                        <span style={{ color: '#64748b', fontSize: 11, minWidth: 20 }}>{idx}.</span>
                                        <code style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11, color: '#e2e8f0' }}>{val}</code>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Generate Verifier button for Noir - redirects to VK page with VK pre-filled */}
                            <div style={{ marginTop: 16 }}>
                              <button
                                type="button"
                                onClick={() => {
                                  localStorage.setItem('cairo_verifier_generator_pending_vk', proveResult.vkBase64);
                                  localStorage.setItem('cairo_verifier_generator_pending_vk_format', 'noir');
                                  window.dispatchEvent(new CustomEvent('pending-vk-updated', { detail: { format: 'noir' } }));
                                  onNavigateToVk();
                                }}
                                className={styles.compileBtn}
                                style={{ width: '100%', padding: '12px 16px', fontSize: 13, borderRadius: 8, fontWeight: 600 }}
                              >
                                Generate Cairo Verifier →
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Circom: Proof JSON */}
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

                            {/* Circom: Public Inputs JSON */}
                            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
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

                            {/* Circom: Calldata Generation */}
                            {setupResult?.vkJson && (
                              <div style={{ flex: 1, marginTop: 12 }}>
                                <button
                                  onClick={handleGenerateCircomCalldata}
                                  disabled={circomCalldataState === 'compiling'}
                                  className={`${styles.compileBtn} ${styles[circomCalldataState]}`}
                                  style={{ width: '100%', padding: '12px 16px', fontSize: 13, borderRadius: 8, fontWeight: 600, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981' }}
                                >
                                  {circomCalldataState === 'compiling' ? <><span className={styles.spinner} style={{ marginRight: 8 }} />Generating Calldata…</> : 'Generate Groth16 Calldata'}
                                </button>

                                {circomCalldataState === 'error' && (
                                  <div className={styles.errorList} style={{ marginTop: 12, padding: 12 }}>
                                    <div className={styles.errorHeader}>✗ Calldata generation failed</div>
                                  </div>
                                )}

                                {circomCalldataState === 'success' && circomCalldataResult && (
                                  <div style={{ marginTop: 16, animation: 'fadeIn 0.3s ease-out' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                      <span className={styles.paneLabelSmall} style={{ color: '#10b981', fontSize: 14 }}>On-chain Calldata (Array)</span>
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(JSON.stringify(circomCalldataResult));
                                          setCopiedCircomCalldata(true);
                                          setTimeout(() => setCopiedCircomCalldata(false), 2000);
                                        }}
                                        className={styles.downloadIconBtn}
                                        style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 4, border: '1px solid #333' }}
                                      >
                                        {copiedCircomCalldata ? <span style={{ color: '#10b981' }}>✓ Copied</span> : 'Copy Array'}
                                      </button>
                                    </div>
                                    <div style={{ background: '#0a0a0c', borderRadius: 6, border: '1px solid #1e293b', padding: 12, maxHeight: 200, overflowY: 'auto' }}>
                                      {circomCalldataResult.map((val, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                                          <span style={{ color: '#64748b', fontSize: 11, minWidth: 20 }}>{idx}.</span>
                                          <code style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 11, color: '#e2e8f0' }}>{val}</code>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
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
                  {language === 'noir' ? (
                    <>
                      <tr>
                        <td style={{ paddingRight: 32, paddingBottom: 4 }}>System</td>
                        <td style={{ paddingBottom: 4 }}><strong>UltraHonk</strong></td>
                      </tr>
                      <tr>
                        <td style={{ paddingRight: 32, paddingBottom: 4 }}>Trusted Setup</td>
                        <td style={{ paddingBottom: 4 }}><strong style={{ color: '#10b981' }}>None (Transparent)</strong></td>
                      </tr>
                      {(compileResult.result as any).gateCount !== undefined && (
                        <>
                          <tr>
                            <td style={{ paddingRight: 32, paddingBottom: 4 }}>Circuit Size</td>
                            <td style={{ paddingBottom: 4 }}><strong>{(compileResult.result as any).gateCount.toLocaleString()}</strong></td>
                          </tr>
                          {(compileResult.result as any).acirOpcodeCount !== undefined && (compileResult.result as any).acirOpcodeCount > 0 && (
                            <tr>
                              <td style={{ paddingRight: 32 }}>ACIR Opcodes</td>
                              <td><strong>{(compileResult.result as any).acirOpcodeCount.toLocaleString()}</strong></td>
                            </tr>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <tr>
                        <td style={{ paddingRight: 32, paddingBottom: 4 }}>System</td>
                        <td style={{ paddingBottom: 4 }}><strong>Groth16</strong></td>
                      </tr>
                      <tr>
                        <td style={{ paddingRight: 32, paddingBottom: 4 }}>Trusted Setup</td>
                        <td style={{ paddingBottom: 4 }}><strong style={{ color: '#f59e0b' }}>Required (Phase 2)</strong></td>
                      </tr>
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
                    </>
                  )}
                </tbody>
              </table>
              {(compileResult.result as any).warnings?.length > 0 && (
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
