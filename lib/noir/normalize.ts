import { CompileError, NoirAbi, NoirCompileResult } from '../circom/types';
import { RawNoirOutput } from './NoirServerCompiler';

// ─── Error mapping ────────────────────────────────────────────────────────────

/**
 * Parse nargo stderr into structured CompileError[].
 *
 * Nargo error format (v1.x):
 *   error: <message>
 *      ┌─ <file>:<line>:<col>
 *      │
 *   N  │   <source line>
 *
 * Patterns are tried most-specific first:
 *   1. error + ┌─ location block → syntax with file/line/col
 *   2. bare "error: ..." → syntax without location
 *   3. everything else → internal (nargo crash, binary not found, etc.)
 */
export function mapNoirErrors(stderr: string): CompileError[] {
  if (!stderr || !stderr.trim()) return [];

  // Pattern 1: error with location block
  // Matches: error: <msg>\n   ┌─ <file>:<line>:<col>
  const withLocationRegex = /error:\s*([^\n]+)\n\s*[\u250c\u2514]\u2500\s*([^:\n]+):(\d+):(\d+)/;
  const withLocationMatch = stderr.match(withLocationRegex);
  if (withLocationMatch) {
    return [
      {
        message: `error: ${withLocationMatch[1].trim()}`,
        category: 'syntax',
        file: stripTempDir(withLocationMatch[2].trim()),
        line: Number(withLocationMatch[3]),
        column: Number(withLocationMatch[4]),
      },
    ];
  }

  // Pattern 2: bare "error: ..." without location
  const bareErrorRegex = /error:\s*([^\n]+)/;
  const bareMatch = stderr.match(bareErrorRegex);
  if (bareMatch) {
    return [
      {
        message: `error: ${bareMatch[1].trim()}`,
        category: 'syntax',
      },
    ];
  }

  // Fallback: return the whole stderr as an internal error
  return [
    {
      message: stderr.trim(),
      category: 'internal',
    },
  ];
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize raw nargo output into a NoirCompileResult.
 *
 * Why: Downstream code (API route, UI) depends on a stable contract, not on
 * raw stdout strings or artifact paths.
 *
 * Note: gateCount is always 0 because nargo v1.x does not expose the ACIR
 * opcode count in the compiled JSON. A separate `bb gates` invocation would
 * be required, which is deferred to a future enhancement.
 *
 * @throws Error if acirJson is missing (caller must check stderr first).
 */
export function normalizeNoirOutput(raw: RawNoirOutput): NoirCompileResult {
  if (!raw.acirJson) {
    throw new Error('No ACIR JSON produced by nargo compile');
  }

  const artifact = JSON.parse(raw.acirJson) as { bytecode: string; abi: NoirAbi };

  const warnings = raw.stdout
    .split('\n')
    .filter((l) => /\[warning\]/i.test(l))
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    gateCount: 0,
    acirOpcodeCount: 0,
    warnings,
    abi: artifact.abi,
    acirBase64: artifact.bytecode,
  };
}

// ─── Validation helper ────────────────────────────────────────────────────────

/**
 * Build a single 'validation' CompileError for pre-compilation checks.
 */
export function makeNoirValidationError(message: string): CompileError {
  return { message, category: 'validation' };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Strip the temp dir absolute path prefix from a nargo error file path.
 *
 * Nargo reports errors with absolute paths like:
 *   /tmp/noir-abc123/src/main.nr
 * We strip everything up to and including the `noir-<id>/` segment so the
 * client sees a clean relative path like `src/main.nr`.
 */
function stripTempDir(filePath: string): string {
  // Match the noir- temp dir segment in any OS temp prefix
  const match = filePath.match(/noir-[^/\\]+[/\\](.*)/);
  return match ? match[1] : filePath;
}
