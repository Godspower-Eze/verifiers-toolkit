// ─── VK schema types ───────────────────────────────────────────────────────────

/**
 * Accepted BN254 curve names in SnarkJS VK JSON.
 * SnarkJS uses "bn128"; Garaga uses "bn254". Both refer to the same curve.
 */
export type BN254CurveName = 'bn128' | 'bn254';

/** A parsed SnarkJS Groth16 Verification Key object. */
export interface SnarkJsVk {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: unknown;
  vk_beta_2: unknown;
  vk_gamma_2: unknown;
  vk_delta_2: unknown;
  vk_alphabeta_12: unknown;
  IC: unknown[];
}

// ─── Validation result ─────────────────────────────────────────────────────────

export interface VkFieldError {
  /** Dot-path of the invalid / missing field, e.g. "curve" or "IC". */
  field: string;
  message: string;
}

export type VkValidationResult =
  | { valid: true; vk: SnarkJsVk }
  | { valid: false; errors: VkFieldError[] };

// ─── JSON parse result ─────────────────────────────────────────────────────────

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
