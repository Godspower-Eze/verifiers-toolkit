import { useState, useEffect, useRef, useCallback } from 'react';
import { useStarknetWalletContext } from '@/components/StarknetWalletProvider';
import { useRecentDeployments, usePersistedVk } from '../hooks/useRecentDeployments';
import MonacoEditor from '@monaco-editor/react';
import { RpcProvider } from 'starknet';
import { generateCalldata } from '../lib/garagaUtils';
import { getRpcUrl, getChainName } from '../lib/starknet/constants';
import DeploymentLogs, { LogEntry, LogType } from './DeploymentLogs';
import type { VkSummary } from '../lib/vk/types';
import type { PublicInputSummary } from '../lib/publicInput/types';
import styles from './VerifyWorkspace.module.css';
import editorStyles from './EditorWorkspace.module.css';
import type { ProofSummary } from '../lib/proof/types';

export default function VerifyWorkspace() {
  const { wallet, address, chainId, isConnected, connectWallet, disconnectWallet } = useStarknetWalletContext();
  const { recentAddresses } = useRecentDeployments();
  const { vkJson, saveVk } = usePersistedVk();

  // ── Layout State
  const outHRef = useRef(180);
  const [outputHeight, _setOutputHeight] = useState(180);
  const setOutputHeight = useCallback((v: number) => { outHRef.current = v; _setOutputHeight(v); }, []);

  // ── Drag Handlers
  const startDrag = useCallback((e: React.MouseEvent, type: 'h' | 'v', onMove: (d: number) => void) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '999999';
    overlay.style.cursor = type === 'h' ? 'col-resize' : 'row-resize';
    document.body.appendChild(overlay);

    document.body.style.cursor = type === 'h' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (type === 'h') onMove(ev.clientX - startX);
      else onMove(ev.clientY - startY);
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, []);

  const dragRowDivider = useCallback((e: React.MouseEvent) => {
    const startH = outHRef.current;
    startDrag(e, 'v', (dy) => setOutputHeight(Math.max(60, Math.min(600, startH - dy))));
  }, [setOutputHeight, startDrag]);

  const [contractAddress, setContractAddress] = useState('');
  const [proofJson, setProofJson] = useState(`{
  // ============== ACCEPTED PROOF FORMATS ============== //

  // 1. SP1 Format
  // "proof": "0x...", 
  // "public_values": "0x...", 
  // "vkey": "0x..."
  
  // 2. RISC0 Format
  // "seal": "0x...", 
  // "image_id": "0x...", 
  // "journal": "0x..."

  // 3. Garaga Nested Object Format
  // "proof": {
  //   "a": { "x": "0x...", "y": "0x..." },
  //   "b": { "x": ["0x...", "0x..."], "y": ["0x...", "0x..."] },
  //   "c": { "x": "0x...", "y": "0x..." }
  // }

  // 4. Groth16 SnarkJS Format
  // "pi_a": ["0x...", "0x...", "1"], 
  // "pi_b": [["0x...", "0x..."], ["0x...", "0x..."]], 
  // "pi_c": ["0x...", "0x...", "1"]

  // 5. Groth16 Gnark Format
  // "Ar": { "X": "...", "Y": "..." }, 
  // "Bs": { "X": { "A0": "...", "A1": "..." }, "Y": { "A0": "...", "A1": "..." } }, 
  // "Krs": { "X": "...", "Y": "..." }
}`);
  const [publicJson, setPublicJson] = useState(`[
  // ============== ACCEPTED PUBLIC INPUTS FORMATS ============== //

  // 1. SnarkJS / SP1 Flat Array Format
  // [
  //   "0x123",
  //   "0x456"
  // ]

  // 2. Gnark Object Mapping Format
  // {
  //   "input_1": "123",
  //   "input_2": "456"
  // }
]`);
  const [currentVkJson, setCurrentVkJson] = useState(vkJson || `{
  // ============== ACCEPTED VK FORMATS ============== //

  // 1. Garaga Nested Object Format
  // "vk": {
  //   "alpha": { "x": "0x...", "y": "0x..." },
  //   "beta": { "x": ["0x...", "0x..."], "y": ["0x...", "0x..."] },
  //   "gamma": { "x": ["0x...", "0x..."], "y": ["0x...", "0x..."] },
  //   "delta": { "x": ["0x...", "0x..."], "y": ["0x...", "0x..."] },
  //   "ic": [ { "x": "0x...", "y": "0x..." } ]
  // }

  // 2. Groth16 SnarkJS Format
  // "protocol": "groth16",
  // "curve": "bn128",
  // "nPublic": 1,
  // "vk_alpha_1": ["0x...", "0x...", "1"],
  // "vk_beta_2": [["0x...", "0x..."], ["0x...", "0x..."]],
  // ...
  
  // 3. Groth16 Gnark Format
  // "Alpha": { "X": "...", "Y": "..." },
  // "Beta": { "X": { "A0": "...", "A1": "..." }, "Y": { "A0": "...", "A1": "..." } },
  // "Gamma": { "X": { "A0": "...", "A1": "..." }, "Y": { "A0": "...", "A1": "..." } },
  // "Delta": { "X": { "A0": "...", "A1": "..." }, "Y": { "A0": "...", "A1": "..." } },
  // "Ic": [ { "X": "...", "Y": "..." } ]
}`);

  const [isVerifying, setIsVerifying] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Validation States
  const [isValidatingProof, setIsValidatingProof] = useState(false);
  const [proofSummary, setProofSummary] = useState<ProofSummary | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  const [isValidatingVk, setIsValidatingVk] = useState(false);
  const [vkSummary, setVkSummary] = useState<VkSummary | null>(null);
  const [vkError, setVkError] = useState<string | null>(null);

  const [isValidatingPublic, setIsValidatingPublic] = useState(false);
  const [publicSummary, setPublicSummary] = useState<PublicInputSummary | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);


  // Proof Validation Effect
  useEffect(() => {
    const timer = setTimeout(async () => {
      const trimmed = proofJson.trim();
      if (!trimmed || !trimmed.startsWith('{')) {
        setProofSummary(null);
        setProofError(null);
        return;
      }
      
      // Fast-fail JSON parsing locally to prevent 400 Bad Request logs in the browser console.
      try {
        JSON.parse(trimmed);
      } catch (err) {
        setProofSummary(null);
        setProofError('Invalid JSON format (check comments and syntax)');
        return;
      }

      setIsValidatingProof(true);
      setProofError(null);
      setProofSummary(null);
      try {
        const resp = await fetch('/api/proof/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proofJson }),
        });
        const result = await resp.json();
        if (result.valid) {
          setProofSummary(result.summary);
        } else {
          setProofError(result.errors?.[0]?.message || 'Invalid proof format');
        }
      } catch (err) {
        setProofError('Validation API unreachable');
      } finally {
        setIsValidatingProof(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [proofJson]);

  // VK Validation Effect
  useEffect(() => {
    const timer = setTimeout(async () => {
      const trimmed = currentVkJson.trim();
      if (!trimmed || !trimmed.startsWith('{')) {
        setVkSummary(null);
        setVkError(null);
        return;
      }

      try {
        JSON.parse(trimmed);
      } catch (err) {
        setVkSummary(null);
        setVkError('Invalid JSON format (check comments and syntax)');
        return;
      }

      setIsValidatingVk(true);
      setVkError(null);
      setVkSummary(null);
      try {
        const resp = await fetch('/api/vk/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vkJson: currentVkJson }),
        });
        const result = await resp.json();
        if (result.valid) {
          setVkSummary(result.summary);
        } else {
          setVkError(result.errors?.[0]?.message || 'Invalid VK format');
        }
      } catch (err) {
        setVkError('Validation API unreachable');
      } finally {
        setIsValidatingVk(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [currentVkJson]);

  // Public Input Validation Effect
  useEffect(() => {
    const timer = setTimeout(async () => {
      const trimmed = publicJson.trim();
      if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        setPublicSummary(null);
        setPublicError(null);
        return;
      }

      try {
        JSON.parse(trimmed);
      } catch (err) {
        setPublicSummary(null);
        setPublicError('Invalid JSON format (check comments and syntax)');
        return;
      }

      setIsValidatingPublic(true);
      setPublicError(null);
      setPublicSummary(null);
      try {
        const resp = await fetch('/api/public-input/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicInputJson: publicJson }),
        });
        const result = await resp.json();
        if (result.valid) {
          setPublicSummary(result.summary);
        } else {
          setPublicError(result.errors?.[0]?.message || 'Invalid Public Input format');
        }
      } catch (err) {
        setPublicError('Validation API unreachable');
      } finally {
        setIsValidatingPublic(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [publicJson]);

  const addLog = (msg: string, type: LogType = 'info') => {
    setLogs((prev) => [...prev, { id: crypto.randomUUID(), timestamp: new Date(), message: msg, type }]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        setter(event.target.result);
      }
    };
    reader.readAsText(file);
    // Reset so the same file could be selected again
    e.target.value = '';
  };

  // Keep local VK state in sync if the persisted one changes (e.g. from another tab)
  useEffect(() => {
    if (vkJson && !currentVkJson) {
      setCurrentVkJson(vkJson);
    }
  }, [vkJson, currentVkJson]);

  const handleVerify = async () => {
    if (!wallet) return;
    setIsVerifying(true);
    setLogs([]);
    addLog(`Initiating verification for contract: ${contractAddress}`, 'info');

    try {
      const parsedProof = JSON.parse(proofJson);
      const parsedPublic = JSON.parse(publicJson);
      const parsedVk = JSON.parse(currentVkJson);

      if (proofSummary && proofSummary.system !== 'groth16') {
        addLog(`On-chain verification for ${proofSummary.system.toUpperCase()} proofs is not yet supported by the generator wrapper.`, 'error');
        setIsVerifying(false);
        return;
      }

      if (!vkSummary || !vkSummary.curve) {
        addLog('Validation must pass in order to determine the VK curve.', 'error');
        setIsVerifying(false);
        return;
      }

      const entryPoint = `verify_groth16_proof_${vkSummary.curve.toLowerCase()}`;

      addLog(`Generating calldata via Garaga adapter for ${vkSummary.curve}...`, 'info');
      let calldata: string[];
      try {
        calldata = await generateCalldata(parsedProof, parsedPublic, parsedVk);
      } catch (err: any) {
        console.error("Calldata generation error:", err);
        addLog(`❌ Invalid Proof: failed the first part of the verification process locally`, 'error');
        setIsVerifying(false);
        return;
      }
      addLog(`Calldata generated. Total args: ${calldata.length}`, 'success');

      addLog(`Sending transaction to wallet (Entrypoint: ${entryPoint})...`, 'info');
      const response = await wallet.request({
        type: 'wallet_addInvokeTransaction',
        params: {
          calls: [{
            contract_address: contractAddress,
            entry_point: entryPoint,
            calldata: calldata
          }]
        }
      });
      addLog(`Transaction broadcasted! Hash: ${response.transaction_hash}`, 'success');
      
      const rpc = new RpcProvider({ nodeUrl: getRpcUrl(chainId) });
      addLog('Waiting for L2 acceptance...', 'info');
      
      const receipt = await rpc.waitForTransaction(response.transaction_hash);
      if (receipt.isSuccess()) {
        addLog('Valid Proof! Transaction accepted on L2 ✅', 'success');
      } else {
        addLog('Transaction failed or rejected.', 'error');
      }
    } catch (err: any) {
      console.error(err);
      addLog(`Failed: ${err.message || String(err)}`, 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className={styles.workspace}>
      <div className={styles.header}>
        <div className={styles.addressSection}>
          <label className={styles.label}>Verifier Contract Address</label>
          <input
            type="text"
            className={styles.addressInput}
            placeholder="0x..."
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
          />
          {recentAddresses.length > 0 && (
            <div className={styles.recentAddresses}>
              <span className={styles.recentLabel}>Recent Deploys:</span>
              {recentAddresses.map((addr) => (
                <button
                  key={addr}
                  className={styles.recentBtn}
                  onClick={() => setContractAddress(addr)}
                  title={addr}
                >
                  {addr.slice(0, 6)}...{addr.slice(-4)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.editorCol}>
          <div className={styles.paneHeader}>
             <div className={styles.paneLabel}>verification_key.json</div>
             <div style={{ display: 'flex', alignItems: 'center' }}>
               {isValidatingVk && <span style={{fontSize: 12, marginRight: 8, color: '#888'}}>Validating...</span>}
               {vkSummary && <span style={{fontSize: 12, marginRight: 8, color: '#4ade80'}}>✓ {vkSummary.curve} ({vkSummary.protocol})</span>}
               {vkError && <span style={{fontSize: 12, marginRight: 8, color: '#f87171'}} title={vkError}>✗ Invalid</span>}
               <label className={styles.uploadBtn}>
                 Load File
                 <input type="file" accept=".json" onChange={(e) => handleFileUpload(e, (val) => { setCurrentVkJson(val); saveVk(val); })} />
               </label>
             </div>
          </div>
          <div className={styles.monacoWrap}>
            <MonacoEditor
              height="100%"
              defaultLanguage="json"
              theme="vs-dark"
              value={currentVkJson}
              onChange={(v) => {
                const val = v ?? '';
                if (val !== currentVkJson) {
                  setCurrentVkJson(val);
                  saveVk(val);
                }
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            />
          </div>
        </div>

        <div className={styles.editorCol}>
          <div className={styles.paneHeader}>
             <div className={styles.paneLabel}>proof.json</div>
             <div style={{ display: 'flex', alignItems: 'center' }}>
               {isValidatingProof && <span style={{fontSize: 12, marginRight: 8, color: '#888'}}>Validating...</span>}
               {proofSummary && <span style={{fontSize: 12, marginRight: 8, color: '#4ade80'}}>✓ {proofSummary.system}</span>}
               {proofError && <span style={{fontSize: 12, marginRight: 8, color: '#f87171'}} title={proofError}>✗ Invalid</span>}
               <label className={styles.uploadBtn}>
                 Load File
                 <input type="file" accept=".json" onChange={(e) => handleFileUpload(e, setProofJson)} />
               </label>
             </div>
          </div>
          <div className={styles.monacoWrap}>
            <MonacoEditor
              height="100%"
              defaultLanguage="json"
              theme="vs-dark"
              value={proofJson}
              onChange={(v) => {
                const val = v ?? '';
                if (val !== proofJson) setProofJson(val);
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            />
          </div>
        </div>

        <div className={styles.editorCol}>
          <div className={styles.paneHeader}>
             <div className={styles.paneLabel}>public.json</div>
             <div style={{ display: 'flex', alignItems: 'center' }}>
               {isValidatingPublic && <span style={{fontSize: 12, marginRight: 8, color: '#888'}}>Validating...</span>}
               {publicSummary && <span style={{fontSize: 12, marginRight: 8, color: '#4ade80'}}>✓ {publicSummary.format.replace('_', ' ')}</span>}
               {publicError && <span style={{fontSize: 12, marginRight: 8, color: '#f87171'}} title={publicError}>✗ Invalid</span>}
               <label className={styles.uploadBtn}>
                 Load File
                 <input type="file" accept=".json" onChange={(e) => handleFileUpload(e, setPublicJson)} />
               </label>
             </div>
          </div>
          <div className={styles.monacoWrap}>
            <MonacoEditor
              height="100%"
              defaultLanguage="json"
              theme="vs-dark"
              value={publicJson}
              onChange={(v) => {
                const val = v ?? '';
                if (val !== publicJson) setPublicJson(val);
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            />
          </div>
        </div>
      </div>
      
      {/* Resizable Divider */}
      <div className={editorStyles.rowDivider} onMouseDown={dragRowDivider} style={{ zIndex: 10 }} />

      <div className={editorStyles.deployFooterWrap}>
        {/* The Verify / Deploy Bar sits on top of the logs */}
        <div className={editorStyles.deployBar}>
          {isConnected ? (
            <>
              <span className={editorStyles.deployLabel} title={address || ''}>
                 {getChainName(chainId)} · {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
              <button 
                onClick={handleVerify}
                disabled={isVerifying || !contractAddress || !vkSummary || !proofSummary || !publicSummary} 
                className={editorStyles.deployBtn}
                title={(!vkSummary || !proofSummary || !publicSummary) ? "All JSON inputs must be valid" : (!contractAddress ? "Enter a contract address" : "")}
              >
                {isVerifying ? 'Verifying...' : 'Verify Onchain'}
              </button>
              <button onClick={disconnectWallet} className={editorStyles.disconnectBtn}>Disconnect</button>
            </>
          ) : (
            <>
              <span className={editorStyles.deployLabel}>Verify on Starknet</span>
              <button 
                onClick={connectWallet} 
                className={editorStyles.deployBtn}
                title="Connect to Verify"
              >
                Connect Wallet
              </button>
            </>
          )}
        </div>

        {/* Logs section */}
        <div className={editorStyles.outputPanel} style={{ height: outputHeight, display: 'flex', flexDirection: 'column' }}>
          <div className={editorStyles.paneLabelSmall}><span>Operation Logs</span></div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <DeploymentLogs logs={logs} emptyText="Verification logs will appear here..." />
          </div>
        </div>
      </div>
    </div>
  );
}
