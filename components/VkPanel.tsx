'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import type { ValidatedVk, VkFieldError, VkSummary } from '@/lib/vk/types';
import styles from './VkPanel.module.css';
import { usePersistedVk } from '@/hooks/useRecentDeployments';

// ─── Types ────────────────────────────────────────────────────────────────────

type VkState = 'idle' | 'validating' | 'valid' | 'invalid';

export type VkFormat = 'circom' | 'noir';

interface VkPanelProps {
  /** Called when a VK is successfully validated. Parent passes it to Feature 05. */
  onValidVk: (vk: ValidatedVk | { vkBase64: string }, format: VkFormat) => void;
  /** Called when the VK is cleared. */
  onClearVk: () => void;
  /** Initial format from navigation (e.g., from Generate Verifier button) */
  initialFormat?: VkFormat;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VkPanel({ onValidVk, onClearVk, initialFormat = 'circom' }: VkPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteValue, setPasteValue] = useState('');
  const [vkState, setVkState] = useState<VkState>('idle');
  const [errors, setErrors] = useState<VkFieldError[]>([]);
  const [validVk, setValidVk] = useState<ValidatedVk | { vkBase64: string } | null>(null);
  const [vkSummary, setVkSummary] = useState<VkSummary | null>(null);
  const [vkFormat, setVkFormat] = useState<VkFormat>(initialFormat);
  const { saveVk } = usePersistedVk();

  // ── Validate ────────────────────────────────────────────────────────────────
  const validateRawJson = useCallback(async (raw: string) => {
    setVkState('validating');
    setErrors([]);
    setValidVk(null);
    setVkSummary(null);

    try {
      // If format is noir or auto-detected as likely noir (starts with AAAA...), validate as noir
      const isNoirFormat = vkFormat === 'noir' || raw.startsWith('AAAA');
      
      if (isNoirFormat) {
        // Validate as Noir VK (binary base64)
        const resp = await fetch('/api/circuit/noir/validate-vk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vkBase64: raw.trim() }),
        });
        const result = await resp.json() as
          | { valid: true; summary: { system: string; curve: string } }
          | { valid: false; errors: VkFieldError[] };

        if (result.valid) {
          setVkState('valid');
          setValidVk({ vkBase64: raw.trim() });
          setVkSummary({
            protocol: result.summary.system,
            curve: result.summary.curve,
            icLength: 0,
          } as VkSummary);
          saveVk(raw);
          onValidVk({ vkBase64: raw.trim() }, 'noir');
        } else {
          setVkState('invalid');
          setErrors(result.errors);
        }
        return;
      }

      // Default: validate as Circom/Groth16 VK (JSON)
      const resp = await fetch('/api/vk/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vkJson: raw }),
      });
      const result = await resp.json() as
        | { valid: true; vk: ValidatedVk; summary: VkSummary }
        | { valid: false; errors: VkFieldError[] };

      if (result.valid) {
        setVkState('valid');
        setValidVk(result.vk);
        setVkSummary(result.summary);
        saveVk(raw);
        onValidVk(result.vk, 'circom');
      } else {
        setVkState('invalid');
        setErrors(result.errors);
      }
    } catch {
      setVkState('invalid');
      setErrors([{ field: 'network', message: 'Could not reach the validation API.' }]);
    }
  }, [vkFormat, onValidVk, saveVk]);

  // ── Auto-load generated VKs ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const pendingVk = localStorage.getItem('cairo_verifier_generator_pending_vk');
      const pendingVkFormat = localStorage.getItem('cairo_verifier_generator_pending_vk_format');
      if (pendingVk) {
        // Set format if provided
        if (pendingVkFormat === 'noir') {
          setVkFormat('noir');
        } else if (pendingVkFormat === 'circom') {
          setVkFormat('circom');
        }
        setPasteValue(pendingVk);
        validateRawJson(pendingVk);
        // Clean up so it doesn't auto-load again if they clear and refresh
        localStorage.removeItem('cairo_verifier_generator_pending_vk');
        localStorage.removeItem('cairo_verifier_generator_pending_vk_format');
      }
    } catch (err) {
      console.error('Failed to read pending VK from local storage:', err);
    }
  }, [validateRawJson]);

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setPasteValue(text);
      validateRawJson(text);
    };
    reader.readAsText(file);
    // Reset the input so the same file could be selected again if needed
    e.target.value = '';
  }, [validateRawJson]);

  // ── Clear ──────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setPasteValue('');
    setVkState('idle');
    setErrors([]);
    setValidVk(null);
    setVkSummary(null);
    onClearVk();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onClearVk]);

  // ── Format change — clear all state before switching ──────────────────────
  const handleFormatChange = useCallback((fmt: VkFormat) => {
    setPasteValue('');
    setVkState('idle');
    setErrors([]);
    setValidVk(null);
    setVkSummary(null);
    onClearVk();
    if (fileInputRef.current) fileInputRef.current.value = '';
    setVkFormat(fmt);
  }, [onClearVk]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Verification Key (VK)</span>
        {vkState === 'valid' && (
          <span className={styles.badge}>✓ Valid {vkFormat === 'noir' ? 'UltraHonk' : 'BN254'}</span>
        )}
      </div>

      {/* Format selector */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>Format:</label>
        <select
          value={vkFormat}
          onChange={(e) => handleFormatChange(e.target.value as VkFormat)}
          style={{
            padding: '4px 8px',
            fontSize: 12,
            background: '#1e293b',
            color: '#e2e8f0',
            border: '1px solid #334155',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          <option value="circom">Circom (JSON)</option>
          <option value="noir">Noir (Binary)</option>
        </select>
      </div>

      {(vkState === 'idle' || vkState === 'validating' || vkState === 'invalid') && (
        <>
          {/* File upload — only shown for Circom (JSON) format */}
          {vkFormat === 'circom' && (
            <div className={styles.uploadRow}>
              <label htmlFor="vk-file-input" className={styles.uploadBtn}>
                ↑ Upload VK JSON
              </label>
              <input
                id="vk-file-input"
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFile}
                className={styles.hiddenInput}
              />
              <span className={styles.orDivider}>or paste below</span>
            </div>
          )}

          {/* Paste textarea */}
          <textarea
            id="vk-paste-input"
            className={styles.textarea}
            placeholder={vkFormat === 'noir' 
              ? 'Paste base64-encoded VK from bb write_vk...' 
              : '{\n  "protocol": "groth16",\n  "curve": "bn128",\n  ...\n}'}
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            rows={6}
            spellCheck={false}
          />

          <button
            id="vk-validate-btn"
            className={styles.validateBtn}
            onClick={() => validateRawJson(pasteValue)}
            disabled={vkState === 'validating' || !pasteValue.trim()}
          >
            {vkState === 'validating' ? 'Validating…' : 'Validate VK'}
          </button>
        </>
      )}

      {/* Valid state summary */}
      {vkState === 'valid' && validVk && vkSummary && (
        <div className={styles.validBlock}>
          <div className={styles.vkSummary}>
            <span>Protocol</span><strong>{vkSummary.protocol}</strong>
            <span>Curve</span><strong>{vkSummary.curve}</strong>
            {vkFormat !== 'noir' && (
              <><span>IC length</span><strong>{vkSummary.icLength}</strong></>
            )}
          </div>
          <button className={styles.clearBtn} onClick={handleClear}>
            ✕ Remove VK
          </button>
        </div>
      )}

      {/* Errors */}
      {vkState === 'invalid' && errors.length > 0 && (
        <div className={styles.errorList}>
          {errors.map((e, i) => (
            <div key={i} className={styles.errorItem}>
              <span className={styles.errorField}>{e.field}</span>
              <span className={styles.errorMsg}>{e.message}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button className={styles.retryBtn} onClick={handleClear}>
              Clear & Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
