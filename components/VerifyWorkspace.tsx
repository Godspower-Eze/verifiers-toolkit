import { useState, useEffect, useRef, useCallback } from 'react';
import { useStarknetWalletContext } from '@/components/StarknetWalletProvider';
import { useRecentDeployments, usePersistedVk } from '../hooks/useRecentDeployments';
import MonacoEditor from '@monaco-editor/react';
import { RpcProvider } from 'starknet';
import { generateCalldata, generateNoirCalldata } from '../lib/garagaUtils';
import { getRpcUrl, getChainName } from '../lib/starknet/constants';
import DeploymentLogs, { LogEntry, LogType } from './DeploymentLogs';
import type { VkSummary } from '../lib/vk/types';
import type { PublicInputSummary } from '../lib/publicInput/types';
import styles from './VerifyWorkspace.module.css';
import editorStyles from './EditorWorkspace.module.css';
import type { ProofSummary } from '../lib/proof/types';
import { parseCalldataInput } from '../lib/utils/parseCalldata';

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

  // ── System switcher
  const [verifySystem, setVerifySystem] = useState<'groth16' | 'ultra_honk'>('groth16');

  // ── Groth16 inputs
  const [contractAddress, setContractAddress] = useState('');
  const [proofJson, setProofJson] = useState(`{
  // ============== ACCEPTED PROOF FORMATS ============== //

  // 1. Groth16 SnarkJS Format
  // "pi_a": ["0x...", "0x...", "1"],
  // "pi_b": [["0x...", "0x..."], ["0x...", "0x..."]],
  // "pi_c": ["0x...", "0x...", "1"]

  // 2. Groth16 Gnark Format
  // "Ar": { "X": "...", "Y": "..." },
  // "Bs": { "X": { "A0": "...", "A1": "..." }, "Y": { "A0": "...", "A1": "..." } },
  // "Krs": { "X": "...", "Y": "..." }

  // 3. SP1 Format
  // "proof": "0x...",
  // "public_values": "0x...",
  // "vkey": "0x..."

  // 4. RISC0 Format
  // "seal": "0x...",
  // "image_id": "0x...",
  // "journal": "0x..."

  // 5. Garaga Nested Object Format
  // "proof": {
  //   "a": { "x": "0x...", "y": "0x..." },
  //   "b": { "x": ["0x...", "0x..."], "y": ["0x...", "0x..."] },
  //   "c": { "x": "0x...", "y": "0x..." }
  // }
}`);
  const [publicJson, setPublicJson] = useState(`[
  // ============== ACCEPTED PUBLIC INPUTS FORMATS ============== //

  // 1. SnarkJS Flat Array Format
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

  // 1. Groth16 SnarkJS Format
  // "protocol": "groth16",
  // "curve": "bn128",
  // "nPublic": 1,
  // "vk_alpha_1": ["0x...", "0x...", "1"],
  // "vk_beta_2": [["0x...", "0x..."], ["0x...", "0x..."]],
  // ...

  // 2. Groth16 Gnark Format
  // "Alpha": { "X": "...", "Y": "..." },
  // "Beta": { "X": { "A0": "...", "A1": "..." }, "Y": { "A0": "...", "A1": "..." } },
  // "Gamma": { "X": { "A0": "...", "A1": "..." }, "Y": { "A0": "...", "A1": "..." } },
  // "Delta": { "X": { "A0": "...", "A1": "..." }, "Y": { "A0": "...", "A1": "..." } },
  // "Ic": [ { "X": "...", "Y": "..." } ]

  // 3. Garaga Nested Object Format
  // "vk": {
  //   "alpha": { "x": "0x...", "y": "0x..." },
  //   "beta": { "x": ["0x...", "0x..."], "y": ["0x...", "0x..."] },
  //   "gamma": { "x": ["0x...", "0x..."], "y": ["0x...", "0x..."] },
  //   "delta": { "x": ["0x...", "0x..."], "y": ["0x...", "0x..."] },
  //   "ic": [ { "x": "0x...", "y": "0x..." } ]
  // }
}`);

  // ── Input mode toggle
  const [inputMode, setInputMode] = useState<'fields' | 'calldata'>('fields');

  // ── Calldata mode inputs
  const [calldataInput, setCalldataInput] = useState('');
  const [calldataCurve, setCalldataCurve] = useState<'BN254' | 'BLS12_381'>('BN254');
  const [uhCalldataInput, setUhCalldataInput] = useState('');

  // ── UltraHonk inputs (raw base64)
  const [uhProofB64, setUhProofB64] = useState('');
  const [uhPublicB64, setUhPublicB64] = useState('');
  const [uhVkB64, setUhVkB64] = useState('');

  // ── UltraHonk validation states
  const [uhVkValid, setUhVkValid] = useState(false);
  const [uhVkError, setUhVkError] = useState<string | null>(null);
  const [uhVkValidating, setUhVkValidating] = useState(false);

  const [isVerifying, setIsVerifying] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // ── Groth16 validation states
  const [isValidatingProof, setIsValidatingProof] = useState(false);
  const [proofSummary, setProofSummary] = useState<ProofSummary | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  const [isValidatingVk, setIsValidatingVk] = useState(false);
  const [vkSummary, setVkSummary] = useState<VkSummary | null>(null);
  const [vkError, setVkError] = useState<string | null>(null);

  const [isValidatingPublic, setIsValidatingPublic] = useState(false);
  const [publicSummary, setPublicSummary] = useState<PublicInputSummary | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);

  // ── System switcher — clear state on switch
  const handleSwitchSystem = useCallback((system: 'groth16' | 'ultra_honk') => {
    setVerifySystem(system);
    setInputMode('fields');
    setLogs([]);
    // Clear UltraHonk fields
    setUhProofB64('');
    setUhPublicB64('');
    setUhVkB64('');
    setUhVkValid(false);
    setUhVkError(null);
    // Clear Groth16 validation
    setProofSummary(null);
    setProofError(null);
    setVkSummary(null);
    setVkError(null);
    setPublicSummary(null);
    setPublicError(null);
  }, []);

  // ── Sync system when Generate Verifier is clicked in EditorWorkspace
  useEffect(() => {
    const handler = (e: Event) => {
      const format = (e as CustomEvent<{ format: string }>).detail?.format;
      if (format === 'noir') handleSwitchSystem('ultra_honk');
      else if (format === 'circom') handleSwitchSystem('groth16');
    };
    window.addEventListener('pending-vk-updated', handler);
    return () => window.removeEventListener('pending-vk-updated', handler);
  }, [handleSwitchSystem]);

  // ── Groth16: Proof Validation Effect
  useEffect(() => {
    if (verifySystem !== 'groth16') return;
    const timer = setTimeout(async () => {
      const trimmed = proofJson.trim();
      if (!trimmed || !trimmed.startsWith('{')) {
        setProofSummary(null);
        setProofError(null);
        return;
      }

      try {
        JSON.parse(trimmed);
      } catch {
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
      } catch {
        setProofError('Validation API unreachable');
      } finally {
        setIsValidatingProof(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [proofJson, verifySystem]);

  // ── Groth16: VK Validation Effect
  useEffect(() => {
    if (verifySystem !== 'groth16') return;
    const timer = setTimeout(async () => {
      const trimmed = currentVkJson.trim();
      if (!trimmed || !trimmed.startsWith('{')) {
        setVkSummary(null);
        setVkError(null);
        return;
      }

      try {
        JSON.parse(trimmed);
      } catch {
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
      } catch {
        setVkError('Validation API unreachable');
      } finally {
        setIsValidatingVk(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [currentVkJson, verifySystem]);

  // ── Groth16: Public Input Validation Effect
  useEffect(() => {
    if (verifySystem !== 'groth16') return;
    const timer = setTimeout(async () => {
      const trimmed = publicJson.trim();
      if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        setPublicSummary(null);
        setPublicError(null);
        return;
      }

      try {
        JSON.parse(trimmed);
      } catch {
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
      } catch {
        setPublicError('Validation API unreachable');
      } finally {
        setIsValidatingPublic(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [publicJson, verifySystem]);

  // ── UltraHonk: VK validation (debounced API call)
  useEffect(() => {
    if (verifySystem !== 'ultra_honk') return;
    const trimmed = uhVkB64.trim();
    if (!trimmed) {
      setUhVkValid(false);
      setUhVkError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setUhVkValidating(true);
      setUhVkError(null);
      try {
        const resp = await fetch('/api/circuit/noir/validate-vk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vkBase64: trimmed }),
        });
        const result = await resp.json();
        if (result.valid) {
          setUhVkValid(true);
          setUhVkError(null);
        } else {
          setUhVkValid(false);
          setUhVkError(result.errors?.[0]?.message || 'Invalid VK');
        }
      } catch {
        setUhVkValid(false);
        setUhVkError('Validation API unreachable');
      } finally {
        setUhVkValidating(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [uhVkB64, verifySystem]);

  const isValidBase64 = (s: string) => {
    const trimmed = s.trim();
    if (!trimmed) return false;
    return /^[A-Za-z0-9+/]+=*$/.test(trimmed);
  };

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
      let calldata: string[];
      let entryPoint: string;

      if (inputMode === 'calldata') {
        // ── Calldata mode: use pasted calldata directly, skip generation
        const raw = verifySystem === 'ultra_honk' ? uhCalldataInput : calldataInput;
        const parsed = parseCalldataInput(raw);
        if (!parsed || parsed.length === 0) {
          addLog('❌ Could not parse calldata. Provide a JSON array or comma-separated hex strings.', 'error');
          setIsVerifying(false);
          return;
        }
        calldata = parsed;
        entryPoint = verifySystem === 'ultra_honk'
          ? 'verify_ultra_keccak_zk_honk_proof'
          : `verify_groth16_proof_${calldataCurve.toLowerCase()}`;
        addLog(`Using pasted calldata (${calldata.length} args) for ${entryPoint}...`, 'info');
      } else if (verifySystem === 'ultra_honk') {
        addLog('Generating UltraHonk calldata via Garaga adapter...', 'info');
        try {
          calldata = await generateNoirCalldata(uhProofB64.trim(), uhPublicB64.trim(), uhVkB64.trim());
        } catch (err: any) {
          addLog(`❌ Calldata generation failed: ${err.message || 'Invalid Proof/VK format'}`, 'error');
          setIsVerifying(false);
          return;
        }
        entryPoint = 'verify_ultra_keccak_zk_honk_proof';
      } else {
        const parsedProof = JSON.parse(proofJson);
        const parsedPublic = JSON.parse(publicJson);
        const parsedVk = JSON.parse(currentVkJson);

        if (proofSummary && !['groth16', 'ultra_honk'].includes(proofSummary.system)) {
          addLog(`On-chain verification for ${proofSummary.system.toUpperCase()} proofs is not yet supported by the generator wrapper.`, 'error');
          setIsVerifying(false);
          return;
        }

        if (!vkSummary || !vkSummary.curve) {
          addLog('Validation must pass in order to determine the VK curve.', 'error');
          setIsVerifying(false);
          return;
        }

        addLog(`Generating Groth16 calldata via Garaga adapter for ${vkSummary.curve}...`, 'info');
        try {
          calldata = await generateCalldata(parsedProof, parsedPublic, parsedVk);
        } catch (err: any) {
          addLog(`❌ Calldata generation failed: ${err.message || 'Invalid Proof/VK format'}`, 'error');
          setIsVerifying(false);
          return;
        }
        entryPoint = `verify_groth16_proof_${vkSummary.curve.toLowerCase()}`;
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

  const isVerifyEnabled = (() => {
    if (!contractAddress) return false;
    if (inputMode === 'calldata') {
      const raw = verifySystem === 'ultra_honk' ? uhCalldataInput : calldataInput;
      return (parseCalldataInput(raw)?.length ?? 0) > 0;
    }
    return verifySystem === 'ultra_honk'
      ? uhVkValid && isValidBase64(uhProofB64) && isValidBase64(uhPublicB64)
      : !!vkSummary && !!proofSummary && !!publicSummary;
  })();

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    background: '#0d1117',
    border: '1px solid #30363d',
    color: '#e2e8f0',
    padding: '12px 14px',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 12,
    borderRadius: 6,
    boxSizing: 'border-box',
    outline: 'none',
    resize: 'vertical',
    lineHeight: 1.5,
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
          {recentAddresses.length > 0 && (() => {
            const filtered = recentAddresses.filter(d =>
              verifySystem === 'groth16' ? d.system === 'groth16' : d.system === 'ultra_keccak_zk_honk'
            );
            if (filtered.length === 0) return null;
            return (
              <div className={styles.recentAddresses}>
                <span className={styles.recentLabel}>Recent Deploys:</span>
                {filtered.map((d) => (
                  <button
                    key={d.address}
                    className={styles.recentBtn}
                    onClick={() => setContractAddress(d.address)}
                    title={d.address}
                  >
                    {d.address.slice(0, 6)}...{d.address.slice(-4)}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>

        {/* System switcher */}
        <div className={styles.systemSwitcher} style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid #30363d', alignSelf: 'center' }}>
          <button
            onClick={() => handleSwitchSystem('groth16')}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: verifySystem === 'groth16' ? 600 : 400,
              background: verifySystem === 'groth16' ? '#1e3a5f' : 'transparent',
              color: verifySystem === 'groth16' ? '#60a5fa' : '#94a3b8',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            Groth16
          </button>
          <button
            onClick={() => handleSwitchSystem('ultra_honk')}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: verifySystem === 'ultra_honk' ? 600 : 400,
              background: verifySystem === 'ultra_honk' ? '#0e3a3a' : 'transparent',
              color: verifySystem === 'ultra_honk' ? '#06b6d4' : '#94a3b8',
              border: 'none',
              borderLeft: '1px solid #30363d',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            UltraHonk
          </button>
        </div>
      </div>

      {/* ── Input mode toggle ── */}
      <div className={styles.modeSwitcher} style={{ display: 'flex', gap: 0, margin: '0 24px 0', borderRadius: 6, overflow: 'hidden', border: '1px solid #30363d', alignSelf: 'flex-start', flexShrink: 0 }}>
        <button
          onClick={() => setInputMode('fields')}
          style={{
            padding: '6px 16px', fontSize: 12, fontWeight: inputMode === 'fields' ? 600 : 400,
            background: inputMode === 'fields' ? 'rgba(255,255,255,0.08)' : 'transparent',
            color: inputMode === 'fields' ? '#e2e8f0' : '#64748b',
            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          VK / Proof / Public
        </button>
        <button
          onClick={() => setInputMode('calldata')}
          style={{
            padding: '6px 16px', fontSize: 12, fontWeight: inputMode === 'calldata' ? 600 : 400,
            background: inputMode === 'calldata' ? 'rgba(255,255,255,0.08)' : 'transparent',
            color: inputMode === 'calldata' ? '#e2e8f0' : '#64748b',
            border: 'none', borderLeft: '1px solid #30363d', cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          Paste Calldata
        </button>
      </div>

      {verifySystem === 'groth16' ? (
        inputMode === 'calldata' ? (
          /* ── Groth16 calldata mode ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 24px', overflowY: 'auto', minHeight: 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>Calldata</span>
                {(['BN254', 'BLS12_381'] as const).map((curve) => (
                  <button
                    key={curve}
                    onClick={() => setCalldataCurve(curve)}
                    style={{
                      padding: '3px 10px', fontSize: 11, borderRadius: 4, border: '1px solid',
                      borderColor: calldataCurve === curve ? 'rgba(96,165,250,0.5)' : '#30363d',
                      background: calldataCurve === curve ? 'rgba(96,165,250,0.1)' : 'transparent',
                      color: calldataCurve === curve ? '#60a5fa' : '#64748b',
                      cursor: 'pointer', fontWeight: calldataCurve === curve ? 600 : 400,
                    }}
                  >
                    {curve}
                  </button>
                ))}
                <span style={{ fontSize: 11, color: '#475569' }}>→ verify_groth16_proof_{calldataCurve.toLowerCase()}</span>
                {calldataInput.trim() && (() => {
                  const parsed = parseCalldataInput(calldataInput);
                  return parsed
                    ? <span style={{ fontSize: 12, color: '#4ade80' }}>✓ {parsed.length} args</span>
                    : <span style={{ fontSize: 12, color: '#f87171' }}>✗ Invalid format — must be hex (0x…) strings</span>;
                })()}
              </div>
              <textarea
                style={{ ...textareaStyle, minHeight: 200, flex: 1 }}
                placeholder={`// Paste calldata as a JSON array or comma-separated hex strings\n// e.g. ["0x1a2b...", "0x3c4d...", ...]\n// Use the calldata generated from the Circuit page.`}
                value={calldataInput}
                onChange={(e) => setCalldataInput(e.target.value)}
                spellCheck={false}
              />
              <p style={{ margin: '8px 0 0', fontSize: 11, color: '#475569' }}>
                Accepts a JSON array <code style={{ color: '#94a3b8' }}>["0x1", "0x2", ...]</code>, decimal strings <code style={{ color: '#94a3b8' }}>["123", "456", ...]</code>, an unquoted array <code style={{ color: '#94a3b8' }}>[0x1, 0x2, ...]</code>, or comma/space-separated values.
              </p>
            </div>
          </div>
        ) : (
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
        )
      ) : (
        inputMode === 'calldata' ? (
          /* ── UltraHonk calldata mode ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 24px', overflowY: 'auto', minHeight: 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>Calldata</span>
                <span style={{ fontSize: 11, color: '#475569' }}>→ verify_ultra_keccak_zk_honk_proof</span>
                {uhCalldataInput.trim() && (() => {
                  const parsed = parseCalldataInput(uhCalldataInput);
                  return parsed
                    ? <span style={{ fontSize: 12, color: '#4ade80' }}>✓ {parsed.length} args</span>
                    : <span style={{ fontSize: 12, color: '#f87171' }}>✗ Invalid format — must be hex (0x…) strings</span>;
                })()}
              </div>
              <textarea
                style={{ ...textareaStyle, minHeight: 200, flex: 1 }}
                placeholder={`// Paste calldata as a JSON array or comma-separated hex strings\n// e.g. ["0x1a2b...", "0x3c4d...", ...]\n// Use the calldata generated from the Circuit page.`}
                value={uhCalldataInput}
                onChange={(e) => setUhCalldataInput(e.target.value)}
                spellCheck={false}
              />
              <p style={{ margin: '8px 0 0', fontSize: 11, color: '#475569' }}>
                Accepts a JSON array <code style={{ color: '#94a3b8' }}>["0x1", ...]</code>, decimal strings <code style={{ color: '#94a3b8' }}>["123", ...]</code>, an unquoted array <code style={{ color: '#94a3b8' }}>[0x1, ...]</code>, or comma/space-separated values.
              </p>
            </div>
          </div>
        ) : (
        /* UltraHonk fields mode — plain textarea inputs */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 24px', overflowY: 'auto', minHeight: 0 }}>

          {/* VK */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>Verification Key (base64)</span>
              {uhVkValidating && <span style={{ fontSize: 12, color: '#888' }}>Validating...</span>}
              {!uhVkValidating && uhVkB64.trim() && uhVkValid && <span style={{ fontSize: 12, color: '#4ade80' }}>✓ Valid UltraHonk VK</span>}
              {!uhVkValidating && uhVkB64.trim() && uhVkError && <span style={{ fontSize: 12, color: '#f87171' }} title={uhVkError}>✗ {uhVkError}</span>}
            </div>
            <textarea
              style={{ ...textareaStyle, minHeight: 100 }}
              placeholder={`// Verification Key (base64)\n// Paste the raw base64 string from:\n//   bb write_vk --oracle_hash keccak -o vk\n// This is the binary VK encoded in base64 (NOT a JSON object).`}
              value={uhVkB64}
              onChange={(e) => setUhVkB64(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Proof */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>Proof (base64)</span>
              {uhProofB64.trim() && isValidBase64(uhProofB64) && <span style={{ fontSize: 12, color: '#4ade80' }}>✓</span>}
              {uhProofB64.trim() && !isValidBase64(uhProofB64) && <span style={{ fontSize: 12, color: '#f87171' }}>✗ Not valid base64</span>}
            </div>
            <textarea
              style={{ ...textareaStyle, minHeight: 100 }}
              placeholder={`// Proof (base64)\n// Paste the raw base64 string from:\n//   bb prove --oracle_hash keccak -o proof`}
              value={uhProofB64}
              onChange={(e) => setUhProofB64(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Public Inputs */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>Public Inputs (base64)</span>
              {uhPublicB64.trim() && isValidBase64(uhPublicB64) && <span style={{ fontSize: 12, color: '#4ade80' }}>✓</span>}
              {uhPublicB64.trim() && !isValidBase64(uhPublicB64) && <span style={{ fontSize: 12, color: '#f87171' }}>✗ Not valid base64</span>}
            </div>
            <textarea
              style={{ ...textareaStyle, minHeight: 100 }}
              placeholder={`// Public Inputs (base64)\n// Paste the raw base64 string from:\n//   bb prove --oracle_hash keccak (the .public file)`}
              value={uhPublicB64}
              onChange={(e) => setUhPublicB64(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
        )
      )}

      {/* Resizable Divider */}
      <div className={editorStyles.rowDivider} onMouseDown={dragRowDivider} style={{ zIndex: 10 }} />

      <div className={`${editorStyles.deployFooterWrap} ${styles.verifyFooter}`}>
        {/* The Verify / Deploy Bar sits on top of the logs */}
        <div className={editorStyles.deployBar}>
          {isConnected ? (
            <>
              <span className={editorStyles.deployLabel} title={address || ''}>
                 {getChainName(chainId)} · {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
              <button
                onClick={handleVerify}
                disabled={isVerifying || !isVerifyEnabled}
                className={editorStyles.deployBtn}
                title={!contractAddress ? 'Enter a contract address' : !isVerifyEnabled ? 'All inputs must be valid' : ''}
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
