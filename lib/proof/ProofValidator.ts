import { ProofValidationResult, ProofFieldError, ParseResult } from './types';
import { parseGroth16ProofFromObject } from '../garagaUtils';

// ─── Utility ──────────────────────────────────────────────────────────────────

export function parseProofJson(json: string): ParseResult<Record<string, unknown>> {
  if (!json || typeof json !== 'string') {
    return { ok: false, error: 'Input must be a non-empty string.' };
  }
  try {
    const data = JSON.parse(json);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
}

// ─── ProofValidator ───────────────────────────────────────────────────────────

export class ProofValidator {
  /**
   * Validates a parsed proof object.
   * Supports Groth16, SP1, and RISC0.
   */
  validate(proof: unknown): ProofValidationResult {
    if (typeof proof !== 'object' || proof === null || Array.isArray(proof)) {
      return {
        valid: false,
        errors: [{ field: 'root', message: 'Proof must be a JSON object.' }],
      };
    }

    const obj = proof as Record<string, unknown>;

    // ── Check RISC0 ───────────────────────────────────────────────────────────
    if (typeof obj.seal === 'string' && typeof obj.image_id === 'string' && typeof obj.journal === 'string') {
      return {
        valid: true,
        proof: obj,
        summary: { system: 'risc0'}
      };
    }

    // ── Check SP1 ─────────────────────────────────────────────────────────────
    if (typeof obj.proof === 'string' && typeof obj.vkey === 'string' && 
        (typeof obj.publicValues === 'string' || typeof obj.public_values === 'string')) {
      return {
        valid: true,
        proof: obj,
        summary: { system: 'sp1' }
      };
    }

    // ── Check Noir (UltraHonk) ────────────────────────────────────────────────
    if (typeof obj.proofBase64 === 'string' && typeof obj.vkBase64 === 'string' && typeof obj.publicInputsBase64 === 'string') {
      return {
        valid: true,
        proof: obj,
        summary: { system: 'ultra_honk' }
      };
    }

    // ── Check Groth16 (Garaga's parser) ───────────────────────────────────────
    try {
      // Garaga's parseGroth16ProofFromObject expects public inputs alongside or embedded.
      // It handles pure point extraction.
      const parsed = parseGroth16ProofFromObject(obj);
      
      const curveName = parsed.curveId === 0 ? 'BN254' :
                        parsed.curveId === 1 ? 'BLS12_381' :
                        `Unknown Curve (${parsed.curveId})`;

      return {
        valid: true,
        proof: obj,
        summary: {
          system: 'groth16',
          curve: curveName,
          publicInputsCount: parsed.publicInputs.length
        }
      };
    } catch (e: any) {
      // If it doesn't match RISC0, SP1, or Groth16, return an error.
      return {
        valid: false,
        errors: [{ field: 'root', message: `Invalid Proof format: ${e.message}` }]
      };
    }
  }
}
