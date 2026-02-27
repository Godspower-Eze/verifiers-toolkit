export type ProofSystem = 'groth16' | 'sp1' | 'risc0';

export interface ProofSummary {
  system: ProofSystem;
  curve?: string;
  publicInputsCount?: number;
}

export type ValidatedProof = Record<string, unknown>;

export interface ProofFieldError {
  field: string;
  message: string;
}

export type ProofValidationResult =
  | { valid: true; proof: ValidatedProof; summary: ProofSummary }
  | { valid: false; errors: ProofFieldError[] };

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
