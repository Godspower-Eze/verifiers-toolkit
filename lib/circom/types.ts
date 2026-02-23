// ─── Language discriminator ────────────────────────────────────────────────────

/**
 * Supported circuit languages.
 * Circom is implemented in Phase 1. Noir is planned for Phase 3 (after Circom
 * end-to-end is complete).
 */
export type LanguageId = 'circom' | 'noir';

// ─── Input ────────────────────────────────────────────────────────────────────

/**
 * Language-agnostic circuit source. The `language` field routes the request to
 * the correct compiler (CircomServerCompiler, NoirServerCompiler, etc.).
 */
export interface CompileSource {
  /** Circuit language. */
  language: LanguageId;
  /** Raw source code (single file, no includes in Phase 1). */
  code: string;
  /** Filename shown in error messages (default: depends on language). */
  filename?: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export type CompileErrorCategory =
  | 'syntax'
  | 'semantic'
  | 'unsupported'
  | 'validation'
  | 'timeout'
  | 'internal';

export interface CompileError {
  message: string;
  category: CompileErrorCategory;
  /** Source file name, if known. */
  file?: string;
  /** 1-indexed line number, if known. */
  line?: number;
  /** 1-indexed column number, if known. */
  column?: number;
}

// ─── Raw output from any compiler subprocess ──────────────────────────────────

export interface RawCompileOutput {
  stdout: string;
  stderr: string;
  /** Primary artifact (R1CS for Circom, ACIR JSON for Noir), if compilation succeeded. */
  artifactBuffer?: Buffer;
  /** Symbol/debug file contents, if generated. */
  symContent?: string;
}

// ─── Language-specific compile results ───────────────────────────────────────

/**
 * Circom Groth16 compilation result.
 * Produced by Feature 01/02.
 */
export interface CircomCompileResult {
  /** Number of R1CS constraints generated. */
  constraintCount: number;
  /** Wire count, if available. */
  wireCount?: number;
  /** Warnings emitted by the compiler. */
  warnings: string[];
}

/**
 * Noir compilation result placeholder.
 * To be defined in Phase 3 when Noir compiler integration begins.
 * Noir produces ACIR (Abstract Circuit IR) + a witness generator (ACVM).
 */
export interface NoirCompileResult {
  /** Number of ACIR opcodes/gates, if reported. */
  gates?: number;
  /** Warnings emitted by the compiler. */
  warnings: string[];
}

/** Union of all language-specific compile results. */
export type LanguageCompileResult = CircomCompileResult | NoirCompileResult;

// ─── API response shapes ──────────────────────────────────────────────────────

export interface CompileSuccessResponse {
  success: true;
  language: LanguageId;
  result: LanguageCompileResult;
}

export interface CompileErrorResponse {
  success: false;
  language: LanguageId;
  errors: CompileError[];
}

export type CompileResponse = CompileSuccessResponse | CompileErrorResponse;
