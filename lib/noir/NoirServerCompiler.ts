import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CompileSource } from '../circom/types';

const execFileAsync = promisify(execFile);

/**
 * Maximum total source bytes across all user-provided files (100 KB guard).
 */
export const MAX_SOURCE_BYTES = 100_000;

/** Default compilation timeout in milliseconds. */
export const COMPILE_TIMEOUT_MS = 60_000;

/** Temp directory prefix used when scanning for leftover dirs in tests. */
export const TEMP_DIR_PREFIX = 'noir-';

/**
 * Path to the nargo binary.
 * Resolution order:
 *   1. NARGO_PATH env var — set this for non-standard installations.
 *   2. 'nargo' — assumed to be in PATH.
 */
const NARGO_PATH = process.env.NARGO_PATH ?? 'nargo';

/**
 * Path to the barretenberg binary.
 */
const BB_PATH = process.env.BB_PATH ?? 'bb';

/** Timeout for bb gates. */
const GATES_TIMEOUT_MS = 30_000;

/**
 * Auto-generated Nargo.toml written to the temp project.
 *
 * Why auto-generate: users shouldn't need to know the Nargo manifest format
 * for simple single-package circuits. The package name is always "circuit"
 * so the artifact path is always `target/circuit.json`.
 *
 * Advanced users who need workspace members or external dependencies can
 * include a Nargo.toml in their file list to override this default.
 */
const DEFAULT_NARGO_TOML = `[package]
name = "circuit"
type = "bin"
authors = []

[dependencies]
`;

/**
 * Raw output returned by NoirServerCompiler.compile().
 * Callers check stderr before using acirJson.
 */
export interface RawNoirOutput {
  stdout: string;
  stderr: string;
  /** Raw JSON string of `target/circuit.json`, present only on success. */
  acirJson?: string;
}

/**
 * NoirServerCompiler — encapsulates all nargo subprocess invocation details.
 *
 * How:
 *   1. Create a temp directory for the Nargo project.
 *   2. Write Nargo.toml (auto-generated unless user provided one).
 *   3. Write source files, creating subdirectories (e.g. src/) as needed.
 *   4. Spawn `nargo compile --package circuit` with cwd = tempDir.
 *   5. On success, read `target/circuit.json` as a string.
 *   6. Clean up the temp dir unconditionally (in finally).
 *
 * @throws Never — errors are returned in `stderr`, not thrown.
 */
export class NoirServerCompiler {
  async compile(source: CompileSource): Promise<RawNoirOutput> {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));

    try {
      // Step 1: Write Nargo.toml if the user hasn't provided one
      const nargoTomlFile = source.files.find((f) => f.filename === 'Nargo.toml');
      let packageName = 'circuit';
      if (!nargoTomlFile) {
        await fs.promises.writeFile(path.join(tempDir, 'Nargo.toml'), DEFAULT_NARGO_TOML, 'utf8');
      } else {
        // Parse the package name from the user-provided Nargo.toml so that
        // --package and the output path (target/<name>.json) stay in sync.
        const nameMatch = nargoTomlFile.content.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch) packageName = nameMatch[1];
      }

      // Step 2: Write all source files (creating subdirectories as needed)
      for (const file of source.files) {
        const filePath = path.join(tempDir, file.filename);
        const fileDir = path.dirname(filePath);
        await fs.promises.mkdir(fileDir, { recursive: true });
        await fs.promises.writeFile(filePath, file.content, 'utf8');
      }

      // Step 3: Spawn nargo compile
      let stdout = '';
      let stderr = '';

      try {
        const result = await execFileAsync(
          NARGO_PATH,
          ['compile', '--package', packageName],
          {
            cwd: tempDir,
            timeout: COMPILE_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024, // 10 MB stdout/stderr buffer
          },
        );
        stdout = result.stdout ?? '';
        stderr = result.stderr ?? '';
      } catch (err: unknown) {
        // execFile rejects on non-zero exit — capture stderr from the error object
        if (isExecError(err)) {
          stdout = err.stdout ?? '';
          stderr = err.stderr ?? '';
          if (err.killed || err.signal === 'SIGTERM') {
            stderr = `Compilation timed out after ${COMPILE_TIMEOUT_MS / 1000}s`;
          }
        } else {
          stderr = String(err);
        }
      }

      // Step 4: Read target/<packageName>.json if produced
      const acirPath = path.join(tempDir, 'target', `${packageName}.json`);
      let acirJson: string | undefined;

      try {
        if (fs.existsSync(acirPath)) {
          acirJson = await fs.promises.readFile(acirPath, 'utf8');
        }
      } catch {
        // Not produced on error path — expected
      }

      return { stdout, stderr, acirJson };
    } finally {
      // Always clean up — even on error
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Get the gate count for a compiled ACIR bytecode.
   * Uses `bb gates` to count the number of gates in the circuit.
   * @param acirJson The full ACIR JSON from nargo compile (not just bytecode)
   * @returns Object with circuitSize (gates) and acirOpcodeCount
   */
  async getGateCount(acirJson: string): Promise<{ circuitSize: number; acirOpcodes: number }> {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));

    try {
      const bytecodePath = path.join(tempDir, 'circuit.json');
      await fs.promises.writeFile(bytecodePath, acirJson, 'utf8');

      try {
        const result = await execFileAsync(
          BB_PATH,
          [
            'gates',
            '-s', 'ultra_honk',
            '--oracle_hash', 'keccak',
            '-b', bytecodePath,
          ],
          {
            cwd: tempDir,
            timeout: GATES_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
          },
        );

        const output = result.stdout ?? '';
        const circuitSizeMatch = output.match(/"circuit_size":\s*(\d+)/);
        const acirOpcodesMatch = output.match(/"acir_opcodes":\s*(\d+)/);
        
        return {
          circuitSize: circuitSizeMatch ? parseInt(circuitSizeMatch[1], 10) : 0,
          acirOpcodes: acirOpcodesMatch ? parseInt(acirOpcodesMatch[1], 10) : 0,
        };
      } catch {
        return { circuitSize: 0, acirOpcodes: 0 };
      }
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface ExecError extends Error {
  code?: number;
  killed?: boolean;
  signal?: string;
  stdout?: string;
  stderr?: string;
}

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error;
}
