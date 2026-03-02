import { PublicInputValidationResult, PublicInputFieldError } from './types';
import { toBigInt } from '../garagaUtils';

// ─── Utility ──────────────────────────────────────────────────────────────────

export function parsePublicInputJson(json: string) {
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

// ─── PublicInputValidator ─────────────────────────────────────────────────────

export class PublicInputValidator {
  /**
   * Validates a parsed public inputs object.
   * Supports Gnark string-mapped Objects and SnarkJS flat Arrays.
   */
  validate(publicInputs: unknown): PublicInputValidationResult {
    if (publicInputs === null || publicInputs === undefined) {
      return {
        valid: false,
        errors: [{ field: 'root', message: 'Public Inputs cannot be null or undefined.' }],
      };
    }

    const errors: PublicInputFieldError[] = [];
    let format: 'gnark_object' | 'stark_array' | 'noir_base64' = 'stark_array';
    let valuesToProcess: any[] = [];

    // ── Check Noir (Base64) ──────────────────────────
    if (typeof publicInputs === 'object' && publicInputs !== null && 'publicInputsBase64' in (publicInputs as any)) {
      format = 'noir_base64';
      // No validation needed for the internal values as it's base64
      return {
        valid: true,
        publicInputs,
        summary: {
          format,
          count: 0 // Count unknown until decoded
        }
      };
    }

    // ── Check Array (SnarkJS / SP1 / RISC0) ──────────
    if (Array.isArray(publicInputs)) {
      format = 'stark_array';
      valuesToProcess = publicInputs;
    } 
    // ── Check Object (Gnark) ─────────────────────────
    else if (typeof publicInputs === 'object') {
      format = 'gnark_object';
      valuesToProcess = Object.values(publicInputs as object);
      
      if (valuesToProcess.length === 0) {
        return {
          valid: false,
          errors: [{ field: 'root', message: 'Public Inputs object is empty.' }]
        };
      }
    } else {
      return {
        valid: false,
        errors: [{ field: 'root', message: 'Public Inputs must be a JSON Array or JSON Object.' }]
      };
    }

    // ── Validate numeric conversion ───────────────────
    for (let i = 0; i < valuesToProcess.length; i++) {
        const val = valuesToProcess[i];
        try {
            toBigInt(val);
        } catch (e: any) {
             errors.push({ field: `index_${i}`, message: `Failed to convert value to BigInt: ${e.message}`});
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors };
    }

    return {
      valid: true,
      publicInputs,
      summary: {
        format,
        count: valuesToProcess.length
      }
    };
  }
}
