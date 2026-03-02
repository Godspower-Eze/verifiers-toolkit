import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logInternalError } from '../utils/serverLogger';

const execFileAsync = promisify(execFile);

export const VERIFY_TEMP_DIR_PREFIX = 'noir-verify-';

export const VERIFY_TIMEOUT_MS = 60_000;

const BB_PATH = process.env.BB_PATH ?? 'bb';

export interface RawNoirVerifyOutput {
  stderr: string;
  stdout: string;
  verified: boolean;
}

export class NoirVerifier {
  async verify(
    proofBuffer: Buffer,
    publicInputsBuffer: Buffer,
    vkBuffer: Buffer,
  ): Promise<RawNoirVerifyOutput> {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), VERIFY_TEMP_DIR_PREFIX));

    try {
      const proofPath = path.join(tempDir, 'proof');
      const publicInputsPath = path.join(tempDir, 'public_inputs');
      const vkPath = path.join(tempDir, 'vk');

      await fs.promises.writeFile(proofPath, proofBuffer);
      await fs.promises.writeFile(publicInputsPath, publicInputsBuffer);
      await fs.promises.writeFile(vkPath, vkBuffer);

      try {
        const { stdout, stderr } = await execFileAsync(
          BB_PATH,
          [
            'verify',
            '-s', 'ultra_honk',
            '--oracle_hash', 'keccak',
            '-p', proofPath,
            '-i', publicInputsPath,
            '-k', vkPath,
          ],
          {
            cwd: tempDir,
            timeout: VERIFY_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
          },
        );

        const verified = stderr.includes('PASS') || stdout.includes('PASS');
        return { stdout, stderr, verified };
      } catch (err) {
        const stderr = extractStderr(err);
        const verified = false;
        return { stdout: '', stderr, verified };
      }
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }
}

interface ExecError extends Error {
  killed?: boolean;
  signal?: string;
  stdout?: string;
  stderr?: string;
}

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error;
}

function extractStderr(err: unknown): string {
  if (isExecError(err)) {
    if (err.killed || err.signal === 'SIGTERM') return `Verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s`;
    return err.stderr || err.stdout || String(err);
  }
  return String(err);
}
