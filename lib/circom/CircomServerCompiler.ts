import { CompileSource, RawCompileOutput } from './types';

/** Maximum allowed source code size in bytes (10 KB pre-compile guard). */
export const MAX_SOURCE_BYTES = 10_000;

/** Default compilation timeout in milliseconds. */
export const COMPILE_TIMEOUT_MS = 30_000;

/**
 * CircomServerCompiler — encapsulates all compiler subprocess invocation details.
 *
 * Why: Isolating FS and process concerns here (SRP) means the API route and tests
 * are decoupled from the OS-level details. Feature 02 will replace the stub body
 * with the real @distributedlab/circom2 invocation.
 *
 * How (stub): Returns a predictable mock result controlled by the source content,
 * making all tests deterministic without a real compiler.
 */
export class CircomServerCompiler {
  /**
   * Compile `source.code` and return raw stdout/stderr/artifacts.
   *
   * - Stub: interprets source content to return success or error output.
   * - Real implementation (Feature 02): writes to temp dir, spawns circom, reads artifacts.
   *
   * @throws Never — errors are returned in `stderr`, not thrown.
   */
  async compile(source: CompileSource): Promise<RawCompileOutput> {
    const filename = source.filename ?? 'circuit.circom';
    const code = source.code;

    // ── Stub logic: simulate compiler behaviour based on source content ──
    // This is replaced by real invocation in Feature 02.

    if (code.includes('__SYNTAX_ERROR__')) {
      return {
        stdout: '',
        stderr: `error[P1002]: found: T_RBRACE\n --> ${filename}:3:1\n  |\n3 | }\n  | ^`,
      };
    }

    if (code.includes('__SEMANTIC_ERROR__')) {
      return {
        stdout: '',
        stderr: `error[T3001]: Variable x not defined\n --> ${filename}:5:5`,
      };
    }

    if (code.includes('include "')) {
      return {
        stdout: '',
        stderr: `error: includes are not supported in single-file mode`,
      };
    }

    // Success path — simulate constraint count extracted from a comment: // constraints: N
    const constraintMatch = code.match(/\/\/ constraints:\s*(\d+)/);
    const constraints = constraintMatch ? constraintMatch[1] : '1';
    const wires = String(Number(constraints) + 2);

    return {
      stdout: [
        `template instances: 1`,
        `non linear constraints: ${constraints}`,
        `linear constraints: 0`,
        `total wires: ${wires}`,
      ].join('\n'),
      stderr: '',
      artifactBuffer: Buffer.from(`r1cs-stub-${filename}`),
    };
  }
}
