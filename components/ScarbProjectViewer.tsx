import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import JSZip from 'jszip';
import type { GeneratedVerifier } from '@/lib/verifier/types';
import styles from './EditorWorkspace.module.css';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type ActiveFile = 'Scarb.toml' | 'lib.cairo' | 'groth16_verifier.cairo' | 'groth16_verifier_constants.cairo';

interface ScarbProjectViewerProps {
  verifier: GeneratedVerifier | null;
  generateState: 'idle' | 'generating' | 'success' | 'error';
  generateError: string | null;
  /** Message shown when no verifier is generated yet */
  emptyMessage?: string;
}

export default function ScarbProjectViewer({ verifier, generateState, generateError, emptyMessage }: ScarbProjectViewerProps) {
  const [activeFile, setActiveFile] = useState<ActiveFile>('groth16_verifier.cairo');
  const [isRootOpen, setIsRootOpen] = useState(true);
  const [isSrcOpen, setIsSrcOpen] = useState(true);

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
      src.file('lib.cairo', libCairoContent);
      src.file('groth16_verifier.cairo', verifier.verifierCairo);
      src.file('groth16_verifier_constants.cairo', verifier.constantsCairo);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${verifier.projectName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [verifier]);

  return (
    <>
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
              {verifier.projectName}
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
                <p>{emptyMessage || 'Generated Cairo verifier will appear here.'}</p>
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
            {verifier && (
              <MonacoEditor
                height="100%"
                language="rust"
                theme="vs-dark"
                value={activeContent}
                options={{
                  readOnly: true,
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
