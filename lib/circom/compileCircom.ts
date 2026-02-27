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
  if (!source.files || source.files.length === 0) {
    return {
      success: false,
      language: source.language,
      errors: [makeValidationError('At least one source file is required.')],
    };
  }

  if (!source.entrypoint) {
    return {
      success: false,
      language: source.language,
      errors: [makeValidationError('An entrypoint filename is required.')],
    };
  }

  const entrypointFile = source.files.find((f) => f.filename === source.entrypoint);
  if (!entrypointFile) {
    return {
      success: false,
      language: source.language,
      errors: [makeValidationError(`Entrypoint "${source.entrypoint}" not found in provided files.`)],
    };
  }

  if (!entrypointFile.content.trim()) {
    return {
      success: false,
      language: source.language,
      errors: [makeValidationError('Entry file must not be empty.')],
    };
  }

  const totalBytes = source.files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);
  if (totalBytes > MAX_SOURCE_BYTES) {
    return {
      success: false,
      language: source.language,
      errors: [
        makeValidationError(
          `Total source size exceeds maximum allowed size of ${MAX_SOURCE_BYTES} bytes (got ${totalBytes} bytes).`
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
