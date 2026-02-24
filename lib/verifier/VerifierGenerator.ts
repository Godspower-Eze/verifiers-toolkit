import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SnarkJsVk } from '@/lib/vk/types';
import type { GeneratedVerifier, GenerateResult } from './types';

const execFileAsync = promisify(execFile);

// ─── Constants ────────────────────────────────────────────────────────────────

/** Timeout for garaga gen (can be slow on first run due to precomputation). */
export const GENERATE_TIMEOUT_MS = 120_000;

/** Temp dir prefix for garaga gen runs. */
export const GARAGA_TEMP_DIR_PREFIX = 'garaga-gen-';

/**
 * Path to the garaga CLI binary.
 * Resolution order:
 *   1. GARAGA_PATH env var — set this in .env.local (run `which garaga` after `pip install garaga`).
 */
export const GARAGA_CLI_PATH = (() => {
  const p = process.env.GARAGA_PATH;
  if (!p) throw new Error('GARAGA_PATH environment variable is not set. Add it to .env.local.');
  return p;
})();

// ─── VerifierGenerator ────────────────────────────────────────────────────────

/**
 * VerifierGenerator — runs `garaga gen` as a subprocess to produce a Cairo
 * Groth16 verifier from a validated SnarkJS VK.
 *
 * Why subprocess: garaga's verifier generation (u384 serialization, miller
 * loop precomputation) is implemented in Python/Rust. Reimplementing it in
 * TypeScript would be error-prone and hard to maintain.
 *
 * How:
 *   1. Write the VK JSON to a temp file.
 *   2. Run: garaga gen --system groth16 --vk <file> --project-name <name>
 *            --no-include-test-sample
 *   3. Read the generated Cairo files from the output folder.
 *   4. Return them as a structured object.
 *   5. Clean up the temp dir unconditionally.
 */
export class VerifierGenerator {
  async generate(vk: SnarkJsVk, projectName = 'groth16_verifier'): Promise<GenerateResult> {
    // Sanitise project name: only lowercase letters, digits, underscores
    const safeName = projectName.replace(/[^a-z0-9_]/gi, '_').toLowerCase();

    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), GARAGA_TEMP_DIR_PREFIX)
    );

    try {
      // Step 1: Write VK JSON
      const vkPath = path.join(tempDir, 'vk.json');
      await fs.promises.writeFile(vkPath, JSON.stringify(vk), 'utf8');

      // Step 2: Run garaga gen
      // garaga outputs the project folder in cwd, so we run it from tempDir
      const args = [
        'gen',
        '--system', 'groth16',
        '--vk', vkPath,
        '--project-name', safeName,
        '--no-include-test-sample',
      ];

      try {
        await execFileAsync(GARAGA_CLI_PATH, args, {
          cwd: tempDir,
          timeout: GENERATE_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (err: unknown) {
        const msg = isExecError(err)
          ? (err.stderr ?? err.stdout ?? String(err))
          : String(err);
        if (isExecError(err) && (err.killed || err.signal === 'SIGTERM')) {
          return { success: false, error: `garaga gen timed out after ${GENERATE_TIMEOUT_MS / 1000}s` };
        }
        return { success: false, error: `garaga gen failed: ${msg}` };
      }

      // Step 3: Read generated files
      const outDir = path.join(tempDir, safeName);
      const srcDir = path.join(outDir, 'src');

      const [verifierCairo, constantsCairo, libCairo, scarbToml] = await Promise.all([
        fs.promises.readFile(path.join(srcDir, 'groth16_verifier.cairo'), 'utf8'),
        fs.promises.readFile(path.join(srcDir, 'groth16_verifier_constants.cairo'), 'utf8'),
        fs.promises.readFile(path.join(srcDir, 'lib.cairo'), 'utf8'),
        fs.promises.readFile(path.join(outDir, 'Scarb.toml'), 'utf8'),
      ]);

      return {
        success: true,
        verifier: { projectName: safeName, verifierCairo, constantsCairo, libCairo, scarbToml },
      };
    } catch (err: unknown) {
      return { success: false, error: String(err) };
    } finally {
      // Step 4: Always clean up
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface ExecError extends Error {
  killed?: boolean;
  signal?: string;
  stdout?: string;
  stderr?: string;
}

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error;
}
