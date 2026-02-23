// ─── Input ───────────────────────────────────────────────────────────────────

export interface CircomSource {
  /** Raw Circom source code (single file, no includes). */
  code: string;
  /** Filename shown in error messages (default: "circuit.circom"). */
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

// ─── Raw output from the compiler subprocess ─────────────────────────────────

export interface RawCompileOutput {
  stdout: string;
  stderr: string;
  /** R1CS file contents as a Buffer, if compilation succeeded. */
  r1csBuffer?: Buffer;
  /** Symbol file contents, if generated. */
  symContent?: string;
}

// ─── Normalized result ─────────────────────────────────────────────────────────

export interface CircomCompileResult {
  /** Number of R1CS constraints generated. */
  constraintCount: number;
  /** Wire count, if available. */
  wireCount?: number;
  /** Warnings emitted by the compiler. */
  warnings: string[];
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface CompileSuccessResponse {
  success: true;
  result: CircomCompileResult;
}

export interface CompileErrorResponse {
  success: false;
  errors: CompileError[];
}

export type CompileResponse = CompileSuccessResponse | CompileErrorResponse;
