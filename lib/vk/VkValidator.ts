import { VkValidationResult, VkFieldError, ValidatedVk, VkSummary, ParseResult, BN254CurveName } from './types';



/** Accepted BN254 curve names (SnarkJS uses "bn128"; Garaga uses "bn254"). */
import { parseGroth16VerifyingKeyFromObject } from '../garagaUtils';

// ─── VkValidator ──────────────────────────────────────────────────────────────

/**
 * VkValidator — validates a parsed VK object using Garaga's native utilities.
 *
 * Why a class: makes it mockable/injectable in future; keeps HTTP layer thin.
 * Why pure (no I/O): fully unit-testable without any server or filesystem.
 */
export class VkValidator {
  /**
   * Validates a parsed VK object against Garaga's supported schemas (SnarkJS, Gnark, sp1, risc0 etc).
   *
   * How:
   *   1. Type-check: must be a non-null object.
   *   2. Use `parseGroth16VerifyingKeyFromObject` from `garagaUtils`.
   *   3. If it does not throw, the schema is cryptographically valid and natively supported.
   *
   * Returns a summary alongside the original valid format so we can render details in the UI without losing structure.
   */
  validate(vk: unknown): VkValidationResult {
    // ── Step 1: Type check ──────────────────────────────────────────────────
    if (typeof vk !== 'object' || vk === null || Array.isArray(vk)) {
      return {
        valid: false,
        errors: [{ field: 'root', message: 'VK must be a JSON object.' }],
      };
    }

    const obj = vk as Record<string, unknown>;

    try {
      // ── Step 2: Use Garaga's internal math parser to validate it ───────
      // ── Check Noir (UltraHonk) ────────────────────────────────────────────────
      if (typeof obj.vkBase64 === 'string') {
        return {
          valid: true,
          vk: obj,
          summary: {
            curve: 'BN254',
            protocol: 'ultra_honk',
            icLength: 0,
          }
        };
      }

      const parsedVk = parseGroth16VerifyingKeyFromObject(vk);
      
      const curveName = parsedVk.alpha.curveId === 0 ? 'BN254' :
                        parsedVk.alpha.curveId === 1 ? 'BLS12_381' :
                        `Unknown Curve (${parsedVk.alpha.curveId})`;
                        
      // Identify protocol heuristically for the UI display, default to Groth16
      let protocolName = 'groth16';
      if (typeof obj.protocol === 'string') {
        protocolName = obj.protocol;
      }

      return {
        valid: true,
        vk: obj,
        summary: {
          curve: curveName,
          protocol: protocolName,
          icLength: parsedVk.ic.length,
        }
      };
    } catch (e: any) {
       return {
         valid: false,
         errors: [{ field: 'root', message: `Invalid Verification Key format: ${e.message}` }]
       };
    }
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
