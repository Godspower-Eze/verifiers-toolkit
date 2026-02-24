import { VkValidationResult, VkFieldError, SnarkJsVk, ParseResult, BN254CurveName } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Required top-level fields in a SnarkJS Groth16 VK. */
const REQUIRED_FIELDS: (keyof SnarkJsVk)[] = [
  'protocol',
  'curve',
  'nPublic',
  'vk_alpha_1',
  'vk_beta_2',
  'vk_gamma_2',
  'vk_delta_2',
  'vk_alphabeta_12',
  'IC',
];

/** Accepted BN254 curve names (SnarkJS uses "bn128"; Garaga uses "bn254"). */
const ACCEPTED_CURVES: BN254CurveName[] = ['bn128', 'bn254'];

// ─── VkValidator ──────────────────────────────────────────────────────────────

/**
 * VkValidator — pure validation logic for SnarkJS Groth16 Verification Keys.
 *
 * Why a class: makes it mockable/injectable in future; keeps HTTP layer thin.
 * Why pure (no I/O): fully unit-testable without any server or filesystem.
 */
export class VkValidator {
  /**
   * Validates a parsed VK object against the SnarkJS Groth16 BN254 schema.
   *
   * How:
   *   1. Type-check: must be a non-null object.
   *   2. Required fields: all fields in REQUIRED_FIELDS must be present.
   *   3. Protocol check: must equal "groth16".
   *   4. Curve check: must be "bn128" or "bn254".
   *   5. IC length: must equal nPublic + 1.
   *
   * Returns all errors found (not short-circuit) so the user sees every problem at once.
   */
  validate(vk: unknown): VkValidationResult {
    const errors: VkFieldError[] = [];

    // ── Step 1: Type check ──────────────────────────────────────────────────
    if (typeof vk !== 'object' || vk === null || Array.isArray(vk)) {
      return {
        valid: false,
        errors: [{ field: 'root', message: 'VK must be a JSON object.' }],
      };
    }

    const obj = vk as Record<string, unknown>;

    // ── Step 2: Required fields ────────────────────────────────────────────
    for (const field of REQUIRED_FIELDS) {
      if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
        errors.push({ field, message: `Missing required field: "${field}".` });
      }
    }

    // If critical fields are missing we can't do further checks reliably
    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // ── Step 3: Protocol ──────────────────────────────────────────────────
    if (obj.protocol !== 'groth16') {
      errors.push({
        field: 'protocol',
        message: `Expected protocol "groth16", got "${obj.protocol}".`,
      });
    }

    // ── Step 4: Curve ─────────────────────────────────────────────────────
    if (!ACCEPTED_CURVES.includes(obj.curve as BN254CurveName)) {
      errors.push({
        field: 'curve',
        message: `Expected curve "bn128" or "bn254" (BN254), got "${obj.curve}".`,
      });
    }

    // ── Step 5: IC length ─────────────────────────────────────────────────
    const nPublic = obj.nPublic as number;
    const IC = obj.IC as unknown[];

    if (!Array.isArray(IC)) {
      errors.push({ field: 'IC', message: 'IC must be an array.' });
    } else if (typeof nPublic !== 'number' || !Number.isInteger(nPublic) || nPublic < 0) {
      errors.push({ field: 'nPublic', message: 'nPublic must be a non-negative integer.' });
    } else if (IC.length !== nPublic + 1) {
      errors.push({
        field: 'IC',
        message: `IC.length must equal nPublic + 1 (expected ${nPublic + 1}, got ${IC.length}).`,
      });
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, vk: obj as unknown as SnarkJsVk };
  }
}

// ─── parseVkJson ──────────────────────────────────────────────────────────────

/**
 * Safely parses a raw JSON string into an unknown value.
 *
 * Why: JSON.parse throws on malformed input; this wraps it into a typed result
 * so the caller never needs a try/catch.
 */
export function parseVkJson(raw: string): ParseResult<unknown> {
  try {
    const data = JSON.parse(raw) as unknown;
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof SyntaxError ? e.message : String(e);
    return { ok: false, error: `Invalid JSON: ${msg}` };
  }
}
