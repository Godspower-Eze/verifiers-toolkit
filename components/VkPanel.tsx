'use client';

import { useCallback, useRef, useState } from 'react';
import type { SnarkJsVk, VkFieldError } from '@/lib/vk/types';
import styles from './VkPanel.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type VkState = 'idle' | 'validating' | 'valid' | 'invalid';

interface VkPanelProps {
  /** Called when a VK is successfully validated. Parent passes it to Feature 05. */
  onValidVk: (vk: SnarkJsVk) => void;
  /** Called when the VK is cleared. */
  onClearVk: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VkPanel({ onValidVk, onClearVk }: VkPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteValue, setPasteValue] = useState('');
  const [vkState, setVkState] = useState<VkState>('idle');
  const [errors, setErrors] = useState<VkFieldError[]>([]);
  const [validVk, setValidVk] = useState<SnarkJsVk | null>(null);

  // ── Validate ────────────────────────────────────────────────────────────────
  const validateRawJson = useCallback(async (raw: string) => {
    setVkState('validating');
    setErrors([]);
    setValidVk(null);

    try {
      const resp = await fetch('/api/vk/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vkJson: raw }),
      });
      const result = await resp.json() as
        | { valid: true; vk: SnarkJsVk }
        | { valid: false; errors: VkFieldError[] };

      if (result.valid) {
        setVkState('valid');
        setValidVk(result.vk);
        onValidVk(result.vk);
      } else {
        setVkState('invalid');
        setErrors(result.errors);
      }
    } catch {
      setVkState('invalid');
      setErrors([{ field: 'network', message: 'Could not reach the validation API.' }]);
    }
  }, [onValidVk]);

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
  }, [validateRawJson]);

  // ── Clear ──────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setPasteValue('');
    setVkState('idle');
    setErrors([]);
    setValidVk(null);
    onClearVk();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onClearVk]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Verification Key (VK)</span>
        {vkState === 'valid' && (
          <span className={styles.badge}>✓ Valid BN254</span>
        )}
      </div>

      {vkState !== 'valid' && (
        <>
          {/* File upload */}
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

          {/* Paste textarea */}
          <textarea
            id="vk-paste-input"
            className={styles.textarea}
            placeholder={'{\n  "protocol": "groth16",\n  "curve": "bn128",\n  ...\n}'}
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
      {vkState === 'valid' && validVk && (
        <div className={styles.validBlock}>
          <div className={styles.vkSummary}>
            <span>Protocol</span><strong>{validVk.protocol}</strong>
            <span>Curve</span><strong>{validVk.curve}</strong>
            <span>Public inputs</span><strong>{validVk.nPublic}</strong>
            <span>IC length</span><strong>{validVk.IC.length}</strong>
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
          <button className={styles.retryBtn} onClick={handleClear}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
