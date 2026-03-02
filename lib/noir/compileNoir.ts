import { CompileSource, CompileResponse } from '../circom/types';
import { NoirServerCompiler, MAX_SOURCE_BYTES } from './NoirServerCompiler';
import { mapNoirErrors, makeNoirValidationError, normalizeNoirOutput } from './normalize';

/**
 * Main entry point for Noir compilation.
 *
 * Mirrors compileCircom(): the API route delegates to this function so it
 * stays thin. This function owns pre-validation and error normalization.
 *
 * How:
 *   1. Pre-validate source → return validation error immediately if invalid.
 *   2. Delegate to NoirServerCompiler.compile → get raw stdout/stderr/acirJson.
 *   3. If stderr is non-empty → map errors and return error response.
 *   4. Otherwise normalize acirJson into NoirCompileResult.
 */
export async function compileNoir(source: CompileSource): Promise<CompileResponse> {
  // ── Step 1: Pre-validation ─────────────────────────────────────────────────

  if (!source.files || source.files.length === 0) {
    return {
      success: false,
      language: source.language,
      errors: [makeNoirValidationError('At least one source file is required.')],
    };
  }

  if (!source.entrypoint) {
    return {
      success: false,
      language: source.language,
      errors: [makeNoirValidationError('An entrypoint filename is required.')],
    };
  }

  const entrypointFile = source.files.find((f) => f.filename === source.entrypoint);
  if (!entrypointFile) {
    return {
      success: false,
      language: source.language,
      errors: [makeNoirValidationError(`Entrypoint "${source.entrypoint}" not found in provided files.`)],
    };
  }

  if (!entrypointFile.content.trim()) {
    return {
      success: false,
      language: source.language,
      errors: [makeNoirValidationError('Entry file must not be empty.')],
    };
  }

  const totalBytes = source.files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);
  if (totalBytes > MAX_SOURCE_BYTES) {
    return {
      success: false,
      language: source.language,
      errors: [
        makeNoirValidationError(
          `Total source size exceeds maximum allowed size of ${MAX_SOURCE_BYTES} bytes (got ${totalBytes} bytes).`,
        ),
      ],
    };
  }

  if (!source.entrypoint.endsWith('.nr')) {
    return {
      success: false,
      language: source.language,
      errors: [makeNoirValidationError('Entrypoint must be a .nr file.')],
    };
  }

  // Nargo requires src/main.nr as the entry point for binary packages.
  const hasSrcMainNr = source.files.some((f) => f.filename === 'src/main.nr');
  if (!hasSrcMainNr) {
    return {
      success: false,
      language: source.language,
      errors: [makeNoirValidationError('Nargo requires a src/main.nr file as the project entry point.')],
    };
  }

  // ── Step 2: Compile ────────────────────────────────────────────────────────

  const compiler = new NoirServerCompiler();
  const raw = await compiler.compile(source);

  // ── Step 3: Map errors ─────────────────────────────────────────────────────

  if (raw.stderr && raw.stderr.trim()) {
    return {
      success: false,
      language: source.language,
      errors: mapNoirErrors(raw.stderr),
    };
  }

  // ── Step 4: Get gate count ─────────────────────────────────────────────────

  const normalized = normalizeNoirOutput(raw);
  let gateCount = 0;
  let acirOpcodeCount = 0;
  try {
    const { circuitSize, acirOpcodes } = await compiler.getGateCount(raw.acirJson!);
    gateCount = circuitSize;
    acirOpcodeCount = acirOpcodes;
  } catch {
    // Gate count is optional - don't fail if bb gates fails
  }

  // ── Step 5: Normalize and return ───────────────────────────────────────────

  return {
    success: true,
    language: source.language,
    result: { ...normalized, gateCount, acirOpcodeCount },
  };
}
