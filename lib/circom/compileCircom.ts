import { CompileSource, CompileResponse } from './types';
import { CircomServerCompiler, MAX_SOURCE_BYTES } from './CircomServerCompiler';
import { mapCompileErrors, makeValidationError, normalizeCompileOutput } from './normalize';

/**
 * Main entry point for Circom compilation.
 *
 * Why: The API route delegates to this function so it stays thin. This function
 * also owns pre-validation (empty source, size limit) and error normalization.
 *
 * How:
 *   1. Pre-validate source → return validation error immediately if invalid.
 *   2. Delegate to CircomServerCompiler.compile → get raw stdout/stderr.
 *   3. If stderr is non-empty → map errors and return error response.
 *   4. Otherwise normalize stdout into CircomCompileResult.
 */
export async function compileCircom(source: CompileSource): Promise<CompileResponse> {
  // ── Step 1: Pre-validation ─────────────────────────────────────────────────
  if (!source.code || !source.code.trim()) {
    return {
      success: false,
      language: source.language,
      errors: [makeValidationError('Source code must not be empty.')],
    };
  }

  const byteLength = Buffer.byteLength(source.code, 'utf8');
  if (byteLength > MAX_SOURCE_BYTES) {
    return {
      success: false,
      language: source.language,
      errors: [
        makeValidationError(
          `Source code exceeds maximum allowed size of ${MAX_SOURCE_BYTES} bytes (got ${byteLength} bytes).`
        ),
      ],
    };
  }

  // ── Step 2: Compile ────────────────────────────────────────────────────────
  const compiler = new CircomServerCompiler();
  const raw = await compiler.compile(source);

  // ── Step 3: Map errors ─────────────────────────────────────────────────────
  if (raw.stderr && raw.stderr.trim()) {
    return {
      success: false,
      language: source.language,
      errors: mapCompileErrors(raw.stderr),
    };
  }

  // ── Step 4: Normalize and return ───────────────────────────────────────────
  return {
    success: true,
    language: source.language,
    result: normalizeCompileOutput(raw),
  };
}
