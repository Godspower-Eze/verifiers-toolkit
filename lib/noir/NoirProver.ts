import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CompileSource } from '../circom/types';
import { logInternalError } from '../utils/serverLogger';

const execFileAsync = promisify(execFile);

// ─── Constants ────────────────────────────────────────────────────────────────

/** Temp directory prefix used by NoirProver (distinct from NoirServerCompiler). */
export const PROVE_TEMP_DIR_PREFIX = 'noir-prove-';

/**
 * Timeout for `nargo execute` (compile + witness generation).
 * Includes compilation time so this is higher than pure witness generation.
 */
export const WITNESS_TIMEOUT_MS = 120_000;

/**
 * Timeout for `bb prove`. Can be slow on first run due to CRS download.
 * Large circuits take longer.
 */
export const PROVE_TIMEOUT_MS = 300_000;

/** Timeout for `bb write_vk`. Typically fast (< 30s). */
export const WRITE_VK_TIMEOUT_MS = 60_000;

/**
 * Path to the nargo binary.
 * Resolution: NARGO_PATH env var → 'nargo' (assumes PATH).
 */
const NARGO_PATH = process.env.NARGO_PATH ?? 'nargo';

/**
 * Path to the bb (barretenberg) binary.
 * Resolution: BB_PATH env var → 'bb' (assumes PATH).
 */
const BB_PATH = process.env.BB_PATH ?? 'bb';

const DEFAULT_NARGO_TOML = `[package]
name = "circuit"
type = "bin"

[dependencies]
`;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Raw output from NoirProver.prove().
 *
 * On success: proofBuffer, publicInputsBuffer, and vkBuffer are all present.
 * On failure: stderr contains the error message; output buffers are absent.
 */
export interface RawNoirProveOutput {
  /** Accumulated stderr from the failing step (empty on success). */
  stderr: string;
  /** Binary proof file from `bb prove` → `target/proof`. */
  proofBuffer?: Buffer;
  /** Binary public inputs file from `bb prove` → `target/public_inputs`. */
  publicInputsBuffer?: Buffer;
  /** Binary verification key from `bb write_vk` → `target/vk`. */
  vkBuffer?: Buffer;
}

/**
 * Serialized prove result returned by the API route.
 * All fields are base64-encoded binary files.
 */
export interface NoirProveResult {
  proofBase64: string;
  publicInputsBase64: string;
  vkBase64: string;
}

// ─── NoirProver ───────────────────────────────────────────────────────────────

/**
 * NoirProver — encapsulates the full UltraHonk proof generation pipeline.
 *
 * Pipeline:
 *   1. Write Nargo project (Nargo.toml + source files) to temp dir.
 *   2. Write Prover.toml from witness inputs.
 *   3. `nargo execute --package circuit`  → compiles + generates target/circuit.gz (witness)
 *      NOTE: nargo execute ALWAYS recompiles from source (ignores pre-built circuit.json).
 *            The source files from the compile step must be included in the prove request.
 *   4. `bb write_vk ...`                 → target/vk  (required BEFORE prove)
 *   5. `bb prove ...`                    → target/proof + target/public_inputs
 *
 * Why write_vk before prove:
 *   bb v3.x requires target/vk to exist before bb prove runs. Attempting to
 *   prove without the VK returns "Unable to open file: ./target/vk".
 *
 * Why source files are required (not just acirBase64):
 *   `nargo execute` recompiles from source on every invocation — it does not
 *   read a pre-built target/circuit.json. Sending source with the prove request
 *   is necessary for correct witness generation.
 *
 * Why not throw:
 *   Errors are returned in `stderr` so the API route can format them
 *   consistently. Only file-system errors that indicate a programming mistake
 *   are logged via logInternalError.
 */
export class NoirProver {
  async prove(
    source: CompileSource,
    inputs: Record<string, unknown>,
  ): Promise<RawNoirProveOutput> {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), PROVE_TEMP_DIR_PREFIX));

    try {
      // ── Step 1: Write Nargo.toml ─────────────────────────────────────────
      const hasNargoToml = source.files.some((f) => f.filename === 'Nargo.toml');
      if (!hasNargoToml) {
        await fs.promises.writeFile(path.join(tempDir, 'Nargo.toml'), DEFAULT_NARGO_TOML, 'utf8');
      }

      // ── Step 2: Write all source files ───────────────────────────────────
      for (const file of source.files) {
        const filePath = path.join(tempDir, file.filename);
        const fileDir = path.dirname(filePath);
        await fs.promises.mkdir(fileDir, { recursive: true });
        await fs.promises.writeFile(filePath, file.content, 'utf8');
      }

      // ── Step 3: Write Prover.toml ─────────────────────────────────────────
      await fs.promises.writeFile(
        path.join(tempDir, 'Prover.toml'),
        serializeProverToml(inputs),
        'utf8',
      );

      // ── Step 4: nargo execute ─────────────────────────────────────────────
      // Compiles from source AND generates target/circuit.gz (the witness).
      // NOTE: nargo execute always recompiles — the compiled target/circuit.json
      // is produced as a side effect of this step.
      try {
        await execFileAsync(NARGO_PATH, ['execute', '--package', 'circuit'], {
          cwd: tempDir,
          timeout: WITNESS_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (err) {
        const stderr = extractStderr(err, `nargo execute timed out after ${WITNESS_TIMEOUT_MS / 1000}s`);
        logInternalError('NoirProver: nargo execute', err);
        return { stderr };
      }

      // ── Step 5: bb write_vk ───────────────────────────────────────────────
      // Generates target/vk. MUST run before bb prove.
      // --oracle_hash keccak: matches garaga's ultra_keccak_zk_honk system.
      try {
        await execFileAsync(
          BB_PATH,
          ['write_vk', '-s', 'ultra_honk', '--oracle_hash', 'keccak',
            '-b', 'target/circuit.json', '-o', 'target/'],
          {
            cwd: tempDir,
            timeout: WRITE_VK_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
          },
        );
      } catch (err) {
        const stderr = extractStderr(err, `bb write_vk timed out after ${WRITE_VK_TIMEOUT_MS / 1000}s`);
        logInternalError('NoirProver: bb write_vk', err);
        return { stderr };
      }

      // ── Step 6: bb prove ──────────────────────────────────────────────────
      // Generates target/proof + target/public_inputs.
      try {
        await execFileAsync(
          BB_PATH,
          ['prove', '-s', 'ultra_honk', '--oracle_hash', 'keccak',
            '-b', 'target/circuit.json',
            '-w', 'target/circuit.gz',
            '-o', 'target/'],
          {
            cwd: tempDir,
            timeout: PROVE_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
          },
        );
      } catch (err) {
        const stderr = extractStderr(err, `bb prove timed out after ${PROVE_TIMEOUT_MS / 1000}s`);
        logInternalError('NoirProver: bb prove', err);
        return { stderr };
      }

      // ── Step 7: Read output files ─────────────────────────────────────────
      try {
        const [proofBuffer, publicInputsBuffer, vkBuffer] = await Promise.all([
          fs.promises.readFile(path.join(tempDir, 'target', 'proof')),
          fs.promises.readFile(path.join(tempDir, 'target', 'public_inputs')),
          fs.promises.readFile(path.join(tempDir, 'target', 'vk')),
        ]);
        return { stderr: '', proofBuffer, publicInputsBuffer, vkBuffer };
      } catch (err) {
        logInternalError('NoirProver: read output files', err);
        return { stderr: 'Proof generated but failed to read output files.' };
      }
    } finally {
      // Always clean up — even on error
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}

// ─── TOML serialization ────────────────────────────────────────────────────────

/**
 * Serialize witness inputs to Nargo's Prover.toml format.
 *
 * Nargo expects:
 *   scalars:  x = "42"            (field elements as quoted strings)
 *   arrays:   arr = ["0", "1"]    (TOML array of quoted strings)
 *
 * Both string and number values are accepted and serialized as strings
 * (field elements have no numeric type distinction in TOML).
 */
export function serializeProverToml(inputs: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      const items = (value as unknown[]).map((v) => `"${String(v)}"`).join(', ');
      lines.push(`${key} = [${items}]`);
    } else {
      lines.push(`${key} = "${String(value)}"`);
    }
  }
  return lines.join('\n');
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

function extractStderr(err: unknown, timeoutMessage: string): string {
  if (isExecError(err)) {
    if (err.killed || err.signal === 'SIGTERM') return timeoutMessage;
    return err.stderr || err.stdout || String(err);
  }
  return String(err);
}
