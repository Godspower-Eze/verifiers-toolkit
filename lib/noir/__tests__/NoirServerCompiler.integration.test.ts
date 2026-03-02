/**
 * Integration tests for NoirServerCompiler — require the real `nargo` binary.
 *
 * All tests in this file are skipped when nargo is not installed.
 * Set NARGO_PATH env var to point to a non-default nargo location.
 */
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { NoirServerCompiler, TEMP_DIR_PREFIX } from '@/lib/noir/NoirServerCompiler';
import { CompileSource } from '@/lib/circom/types';

jest.setTimeout(120_000); // nargo compilation can be slow

// ─── Detect nargo ─────────────────────────────────────────────────────────────

const NARGO_BIN = process.env.NARGO_PATH ?? 'nargo';
const NARGO_AVAILABLE = (() => {
  try {
    execSync(`${NARGO_BIN} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const describeWhenNargo = NARGO_AVAILABLE ? describe : describe.skip;

// ─── Fixture circuits ─────────────────────────────────────────────────────────

const MINIMAL_CIRCUIT = `fn main(x: Field) {}`;

const MULTIPLIER_CIRCUIT = `fn main(a: Field, b: pub Field) -> pub Field {
    a * b
}`;

const SYNTAX_ERROR_CIRCUIT = `fn main(x Field) {}`; // missing colon — parse error

const MULTI_FILE_MAIN = `use crate::lib::double;

fn main(x: Field) -> pub Field {
    double(x)
}`;

const MULTI_FILE_LIB = `pub fn double(x: Field) -> Field {
    x + x
}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noirSource(content: string): CompileSource {
  return {
    language: 'noir',
    files: [{ filename: 'src/main.nr', content }],
    entrypoint: 'src/main.nr',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describeWhenNargo('NoirServerCompiler (real nargo)', () => {
  const compiler = new NoirServerCompiler();

  describe('successful compilation', () => {
    it('compiles a minimal circuit and returns acirJson', async () => {
      const result = await compiler.compile(noirSource(MINIMAL_CIRCUIT));
      expect(result.acirJson).toBeDefined();
      expect(result.acirJson!.length).toBeGreaterThan(0);
      expect(result.stderr).toBe('');
    });

    it('acirJson is valid JSON', async () => {
      const result = await compiler.compile(noirSource(MINIMAL_CIRCUIT));
      expect(() => JSON.parse(result.acirJson!)).not.toThrow();
    });

    it('acirJson contains bytecode and abi fields', async () => {
      const result = await compiler.compile(noirSource(MINIMAL_CIRCUIT));
      const artifact = JSON.parse(result.acirJson!);
      expect(artifact).toHaveProperty('bytecode');
      expect(artifact).toHaveProperty('abi');
    });

    it('abi.parameters is an array', async () => {
      const result = await compiler.compile(noirSource(MINIMAL_CIRCUIT));
      const artifact = JSON.parse(result.acirJson!);
      expect(Array.isArray(artifact.abi.parameters)).toBe(true);
    });

    it('abi reflects the fn main parameter (Field x)', async () => {
      const result = await compiler.compile(noirSource(MINIMAL_CIRCUIT));
      const artifact = JSON.parse(result.acirJson!);
      expect(artifact.abi.parameters).toHaveLength(1);
      expect(artifact.abi.parameters[0].name).toBe('x');
      expect(artifact.abi.parameters[0].type.kind).toBe('field');
    });

    it('compiles multiplier circuit with pub return type', async () => {
      const result = await compiler.compile(noirSource(MULTIPLIER_CIRCUIT));
      expect(result.acirJson).toBeDefined();
      expect(result.stderr).toBe('');
      const artifact = JSON.parse(result.acirJson!);
      expect(artifact.abi.parameters).toHaveLength(2);
    });
  });

  describe('error paths', () => {
    it('returns non-empty stderr for a syntax error', async () => {
      const result = await compiler.compile(noirSource(SYNTAX_ERROR_CIRCUIT));
      expect(result.stderr.trim()).not.toBe('');
      expect(result.acirJson).toBeUndefined();
    });

    it('stderr contains "error" for a syntax error', async () => {
      const result = await compiler.compile(noirSource(SYNTAX_ERROR_CIRCUIT));
      expect(result.stderr.toLowerCase()).toContain('error');
    });

    it('does not throw — errors are returned in stderr, not thrown', async () => {
      await expect(compiler.compile(noirSource(SYNTAX_ERROR_CIRCUIT))).resolves.toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('does not leave temp directories behind after successful compilation', async () => {
      const before = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith(TEMP_DIR_PREFIX));
      await compiler.compile(noirSource(MINIMAL_CIRCUIT));
      const after = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith(TEMP_DIR_PREFIX));
      expect(after.length).toBeLessThanOrEqual(before.length);
    });

    it('does not leave temp directories behind after a compile error', async () => {
      const before = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith(TEMP_DIR_PREFIX));
      await compiler.compile(noirSource(SYNTAX_ERROR_CIRCUIT));
      const after = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith(TEMP_DIR_PREFIX));
      expect(after.length).toBeLessThanOrEqual(before.length);
    });
  });

  describe('multi-file compilation', () => {
    it('compiles a two-file project correctly', async () => {
      const source: CompileSource = {
        language: 'noir',
        files: [
          { filename: 'src/main.nr', content: MULTI_FILE_MAIN },
          { filename: 'src/lib.nr', content: MULTI_FILE_LIB },
        ],
        entrypoint: 'src/main.nr',
      };
      const result = await compiler.compile(source);
      expect(result.acirJson).toBeDefined();
      expect(result.stderr).toBe('');
    });
  });
});
