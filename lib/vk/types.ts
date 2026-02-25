// ─── VK schema types ───────────────────────────────────────────────────────────

/**
 * Accepted BN254 curve names in SnarkJS VK JSON.
 * SnarkJS uses "bn128"; Garaga uses "bn254". Both refer to the same curve.
 */
export type BN254CurveName = 'bn128' | 'bn254';

/** A validated Verification Key object, originating from any supported format. */
export type ValidatedVk = Record<string, unknown>;

export interface VkSummary {
  curve: string;
  protocol: string;
  icLength: number;
}

// ─── Validation result ─────────────────────────────────────────────────────────

export interface VkFieldError {
  /** Dot-path of the invalid / missing field, e.g. "curve" or "IC". */
  field: string;
  message: string;
}

export type VkValidationResult =
  | { valid: true; vk: ValidatedVk; summary: VkSummary }
  | { valid: false; errors: VkFieldError[] };

// ─── JSON parse result ─────────────────────────────────────────────────────────

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
