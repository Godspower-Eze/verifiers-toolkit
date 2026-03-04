import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import JSZip from 'jszip';
import type { GeneratedVerifier } from '@/lib/verifier/types';
import styles from './EditorWorkspace.module.css';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const CairoIcon = ({ size = 12, style }: { size?: number, style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, ...style }}>
    <path fill="#fe4a3c" d="M12.0002 2C6.48044 2 2 6.48085 2 12.0002c0 2.3376.82268 4.5024 2.16441 6.2124 1.08241-1.5369 2.251-2.9871 3.7232-4.1776.0435-.0435.15161-.1082.28128-.1947.60603-.4545 1.03891-1.1255 1.14703-1.8832v-.0215c.36785-2.44612 1.36368-3.29034 4.15608-3.29034.2382 0 .5195 0 .7792.02154 1.4287.06504 2.251.47638 2.3376.69262.065.10811.0435.23818.0215.36784l-.1081-.02154c-.8873-.10812-2.2295.15161-2.4242 1.12548-.1081.541.0216 1.1471.0651 1.6885.065.5629.1081 1.147.1081 1.71 0 .0434-.0435.2597 0 .2812-1.5153-1.4502-5.02185.3679-6.12581 1.169.10812-.0435.21665-.0866.34631-.1301 1.06046-.3678 4.2427-1.3201 5.4763-.2597 1.0389 1.2771.1081 3.6366-.6711 4.8052-.4544.6926-1.0174 1.3202-1.645 1.8616h.3679C17.5196 21.9569 22 17.4761 22 11.9567 22 6.43736 17.5415 2 12.0002 2Zm1.147 5.41124c-1.0824 0-1.9697-.88731-1.9697-1.96972 0-1.08241.8873-1.96972 1.9697-1.96972 1.0825 0 1.9698.88731 1.9698 1.96972 0 1.08241-.8658 1.96972-1.9698 1.96972Z"/>
  </svg>
);

const TomlIcon = ({ size = 12, style }: { size?: number, style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
    <polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>
  </svg>
);

type ActiveFile = string;

interface ScarbProjectViewerProps {
  verifier: GeneratedVerifier | null;
  generateState: 'idle' | 'generating' | 'success' | 'error';
  generateError: string | null;
  /** Message shown when no verifier is generated yet */
  emptyMessage?: string;
}

export default function ScarbProjectViewer({ verifier, generateState, generateError, emptyMessage }: ScarbProjectViewerProps) {
  const isNoir = verifier?.system === 'ultra_keccak_zk_honk';
  
  const mainContractFile = isNoir ? 'honk_verifier.cairo' : 'groth16_verifier.cairo';
  const constantsFile = isNoir ? 'honk_verifier_constants.cairo' : 'groth16_verifier_constants.cairo';
  const circuitsFile = isNoir ? 'honk_verifier_circuits.cairo' : null;
  
  const [activeFile, setActiveFile] = useState<ActiveFile>(mainContractFile);
  const [isRootOpen, setIsRootOpen] = useState(true);
  const [isSrcOpen, setIsSrcOpen] = useState(true);

  // ── Helpers
  const libCairoContent = isNoir 
    ? "mod honk_verifier_constants;\nmod honk_verifier_circuits;\nmod honk_verifier;\n"
    : "mod groth16_verifier_constants;\nmod groth16_verifier;\n";
    
  const activeContent = verifier
    ? activeFile === 'Scarb.toml' ? verifier.scarbToml
    : activeFile === 'lib.cairo' ? libCairoContent
    : activeFile === mainContractFile ? verifier.verifierCairo
    : activeFile === constantsFile ? verifier.constantsCairo
    : (isNoir && activeFile === circuitsFile) ? verifier.circuitsCairo || ''
    : ''
    : '';

  const handleDownloadZip = useCallback(async () => {
    if (!verifier) return;
    const zip = new JSZip();
    zip.file('Scarb.toml', verifier.scarbToml);
    const src = zip.folder('src');
    if (src) {
      src.file('lib.cairo', libCairoContent);
      src.file(mainContractFile, verifier.verifierCairo);
      src.file(constantsFile, verifier.constantsCairo);
      if (isNoir && verifier.circuitsCairo) {
        src.file(circuitsFile!, verifier.circuitsCairo);
      }
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
  }, [verifier, isNoir, mainContractFile, constantsFile, circuitsFile, libCairoContent]);

  return (
    <div className={styles.viewerRoot}>
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
            <div className={styles.desktopFileTree}>
              {/* Desktop-only Tree View */}
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
                    <TomlIcon style={{ marginRight: 4 }} />
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
                        <CairoIcon style={{ marginRight: 4 }} />
                        lib.cairo
                      </div>
                      <div
                        className={`${styles.fileTreeItemNested} ${activeFile === mainContractFile ? styles.fileTreeActive : ''}`}
                        onClick={() => setActiveFile(mainContractFile)}
                        style={{ paddingLeft: 52, ...(activeFile === mainContractFile ? { paddingLeft: 50 } : {}) }}
                      >
                        <CairoIcon style={{ marginRight: 4 }} />
                        {mainContractFile}
                      </div>
                      {isNoir && circuitsFile && (
                        <div
                          className={`${styles.fileTreeItemNested} ${activeFile === circuitsFile ? styles.fileTreeActive : ''}`}
                          onClick={() => setActiveFile(circuitsFile)}
                          style={{ paddingLeft: 52, ...(activeFile === circuitsFile ? { paddingLeft: 50 } : {}) }}
                        >
                          <CairoIcon style={{ marginRight: 4 }} />
                          {circuitsFile}
                        </div>
                      )}
                      <div
                        className={`${styles.fileTreeItemNested} ${activeFile === constantsFile ? styles.fileTreeActive : ''}`}
                        onClick={() => setActiveFile(constantsFile)}
                        style={{ paddingLeft: 52, ...(activeFile === constantsFile ? { paddingLeft: 50 } : {}) }}
                      >
                        <CairoIcon style={{ marginRight: 4 }} />
                        {constantsFile}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
 
            {/* Mobile-only Tabs View */}
            <div className={styles.mobileFileTabs}>
              <div
                className={`${styles.fileTreeItem} ${activeFile === 'Scarb.toml' ? styles.fileTreeActive : ''}`}
                onClick={() => setActiveFile('Scarb.toml')}
              >
                <TomlIcon style={{ marginRight: 6 }} />
                Scarb.toml
              </div>
              
              <div
                className={`${styles.fileTreeItem} ${activeFile === 'lib.cairo' ? styles.fileTreeActive : ''}`}
                onClick={() => setActiveFile('lib.cairo')}
              >
                <CairoIcon style={{ marginRight: 6 }} />
                src/lib.cairo
              </div>
              
              <div
                className={`${styles.fileTreeItem} ${activeFile === mainContractFile ? styles.fileTreeActive : ''}`}
                onClick={() => setActiveFile(mainContractFile)}
              >
                <CairoIcon style={{ marginRight: 6 }} />
                src/{mainContractFile}
              </div>
              
              {isNoir && circuitsFile && (
                <div
                  className={`${styles.fileTreeItem} ${activeFile === circuitsFile ? styles.fileTreeActive : ''}`}
                  onClick={() => setActiveFile(circuitsFile)}
                >
                  <CairoIcon style={{ marginRight: 6 }} />
                  src/{circuitsFile}
                </div>
              )}
 
              <div
                className={`${styles.fileTreeItem} ${activeFile === constantsFile ? styles.fileTreeActive : ''}`}
                onClick={() => setActiveFile(constantsFile)}
              >
                <CairoIcon style={{ marginRight: 6 }} />
                src/{constantsFile}
              </div>
            </div>
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
              <div className={styles.cairoPlaceholder}>Generation failed — see the error above.</div>
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
    </div>
  );
}
