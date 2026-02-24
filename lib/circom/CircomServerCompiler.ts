import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CompileSource, RawCompileOutput } from './types';

const execFileAsync = promisify(execFile);

/** Maximum allowed source code size in bytes (10 KB pre-compile guard). */
export const MAX_SOURCE_BYTES = 10_000;

/** Default compilation timeout in milliseconds. */
export const COMPILE_TIMEOUT_MS = 30_000;

/** Temp directory prefix used when scanning for leftover dirs in tests. */
export const TEMP_DIR_PREFIX = 'circom-';

/**
 * Absolute path to the circom CLI shipped with @distributedlab/circom2.
 *
 * Resolution order:
 *   1. CIRCOM_CLI_PATH env var — set this explicitly in monorepos or
 *      non-standard deployments where node_modules may be hoisted.
 *   2. process.cwd()/node_modules/... — works for standard Docker, Vercel,
 *      Railway, and local dev setups where node_modules is at the project root.
 *
 * Note: require.resolve() is NOT used here because Turbopack intercepts it at
 * compile time (even for server-external packages) and replaces it with a
 * virtual module path that doesn't exist on disk at runtime.
 */
const CIRCOM_CLI_PATH =
  process.env.CIRCOM_CLI_PATH ??
  path.join(process.cwd(), 'node_modules/@distributedlab/circom2/dist/cli.js');

/**
 * CircomServerCompiler — encapsulates all compiler subprocess invocation details.
 *
 * Why: Isolating FS and process concerns here (SRP) keeps the API route and
 * compileCircom() decoupled from OS-level details.
 *
 * How:
 *   1. Create a temp directory for input + output files.
 *   2. Write source to `main.circom` in the temp dir.
 *   3. Spawn `node cli.js main.circom --r1cs --sym -o tempDir/` via execFile.
 *   4. Capture stdout/stderr from the child process.
 *   5. Read the produced `.r1cs` file (if any) into a Buffer.
 *   6. Clean up the temp dir unconditionally.
 *
 * @throws Never — errors are returned in `stderr`, not thrown.
 */
export class CircomServerCompiler {
  async compile(source: CompileSource): Promise<RawCompileOutput> {
    const filename = source.filename ?? 'main.circom';
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));

    try {
      // Step 1: Write source to temp dir
      const inputPath = path.join(tempDir, filename);
      await fs.promises.writeFile(inputPath, source.code, 'utf8');

      // Step 2: Build circom args
      // --r1cs: emit R1CS constraints file
      // --sym:  emit symbol file (signal names, useful for debugging)
      // -o:     output directory
      const args = [
        '--no-warnings',          // suppress Node's WASI ExperimentalWarning
        CIRCOM_CLI_PATH,
        inputPath,
        '--r1cs',
        '--sym',
        '-o', `${tempDir}/`,
      ];

      // Step 3: Spawn circom via node CLI, with timeout
      let stdout = '';
      let stderr = '';

      try {
        const result = await execFileAsync(process.execPath, args, {
          timeout: COMPILE_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024, // 10 MB stdout/stderr buffer
        });
        stdout = result.stdout ?? '';
        stderr = filterWasiWarning(result.stderr ?? '');
      } catch (err: unknown) {
        // execFile rejects on non-zero exit — capture stderr from the error
        if (isExecError(err)) {
          stdout = err.stdout ?? '';
          stderr = filterWasiWarning(err.stderr ?? '');
          if (err.killed || err.signal === 'SIGTERM') {
            stderr = `Compilation timed out after ${COMPILE_TIMEOUT_MS / 1000}s`;
          }
        } else {
          stderr = String(err);
        }
      }

      // Step 4: Read R1CS artifact if present
      const r1csName = filename.replace(/\.circom$/, '.r1cs');
      const r1csPath = path.join(tempDir, r1csName);
      let artifactBuffer: Buffer | undefined;

      try {
        if (fs.existsSync(r1csPath)) {
          artifactBuffer = await fs.promises.readFile(r1csPath);
        }
      } catch {
        // R1CS not produced (compile error path) — expected, not an error
      }

      // Step 5: Read sym file if present
      const symName = filename.replace(/\.circom$/, '.sym');
      const symPath = path.join(tempDir, symName);
      let symContent: string | undefined;

      try {
        if (fs.existsSync(symPath)) {
          symContent = await fs.promises.readFile(symPath, 'utf8');
        }
      } catch {
        // sym not produced — expected on error path
      }

      return { stdout, stderr, artifactBuffer, symContent };
    } finally {
      // Step 6: Always clean up — even on error
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Strip Node's WASI ExperimentalWarning lines from stderr.
 * These are emitted by Node itself (not circom) and are not compiler errors.
 */
function filterWasiWarning(stderr: string): string {
  return stderr
    .split('\n')
    .filter(
      (l) =>
        !l.includes('ExperimentalWarning') &&
        !l.includes('experimental feature') &&
        !l.includes('--trace-warnings')
    )
    .join('\n')
    .trim();
}

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
