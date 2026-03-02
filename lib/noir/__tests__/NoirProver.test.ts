/**
 * Tests for NoirProver — unit tests for serializeProverToml + integration tests
 * for the full prove cycle (nargo execute → bb write_vk → bb prove).
 *
 * Integration tests require both `nargo` and `bb` binaries. They are skipped
 * when either is absent.
 * Set NARGO_PATH / BB_PATH env vars to point to non-default installations.
 */
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { NoirProver, serializeProverToml, PROVE_TEMP_DIR_PREFIX } from '@/lib/noir/NoirProver';
import { CompileSource } from '@/lib/circom/types';

jest.setTimeout(180_000); // bb prove can be slow on first run (CRS download)

// ─── Binary detection ─────────────────────────────────────────────────────────

const NARGO_BIN = process.env.NARGO_PATH ?? 'nargo';
const BB_BIN = process.env.BB_PATH ?? 'bb';

const NARGO_AVAILABLE = (() => {
  try { execSync(`${NARGO_BIN} --version`, { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

const BB_AVAILABLE = (() => {
  try { execSync(`${BB_BIN} --version`, { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

const describeWhenBoth = (NARGO_AVAILABLE && BB_AVAILABLE) ? describe : describe.skip;

// ─── Fixture circuits ─────────────────────────────────────────────────────────

const MULTIPLIER_CIRCUIT = `fn main(a: Field, b: pub Field) {
    assert(a * b != 0);
}`;

function noirSource(content: string): CompileSource {
  return {
    language: 'noir',
    files: [{ filename: 'src/main.nr', content }],
    entrypoint: 'src/main.nr',
  };
}

// ─── serializeProverToml ───────────────────────────────────────────────────────

describe('serializeProverToml', () => {
  it('returns empty string for empty inputs', () => {
    expect(serializeProverToml({})).toBe('');
  });

  it('serializes a string scalar as a quoted value', () => {
    expect(serializeProverToml({ x: '42' })).toBe('x = "42"');
  });

  it('serializes a number scalar as a quoted string value', () => {
    expect(serializeProverToml({ x: 5 })).toBe('x = "5"');
  });

  it('serializes a number 0 as "0"', () => {
    expect(serializeProverToml({ x: 0 })).toBe('x = "0"');
  });

  it('serializes an array of strings as a TOML array', () => {
    expect(serializeProverToml({ arr: ['1', '2', '3'] })).toBe('arr = ["1", "2", "3"]');
  });

  it('serializes an array of numbers as a TOML array of quoted strings', () => {
    expect(serializeProverToml({ arr: [0, 1, 2] })).toBe('arr = ["0", "1", "2"]');
  });

  it('serializes multiple inputs as separate lines', () => {
    const result = serializeProverToml({ x: '5', y: '10' });
    expect(result).toContain('x = "5"');
    expect(result).toContain('y = "10"');
    expect(result.split('\n')).toHaveLength(2);
  });

  it('serializes mixed scalar and array inputs', () => {
    const result = serializeProverToml({ x: '3', arr: ['0', '1'] });
    expect(result).toContain('x = "3"');
    expect(result).toContain('arr = ["0", "1"]');
  });

  it('quotes large field element values', () => {
    const big = '21888242871839275222246405745257275088548364400416034343698204186575808495617';
    expect(serializeProverToml({ x: big })).toBe(`x = "${big}"`);
  });
});

// ─── NoirProver integration tests ─────────────────────────────────────────────

describeWhenBoth('NoirProver (real nargo + bb)', () => {
  const prover = new NoirProver();
  const source = noirSource(MULTIPLIER_CIRCUIT);

  describe('successful proof', () => {
    it('returns non-empty proofBuffer', async () => {
      const result = await prover.prove(source, { a: '3', b: '7' });
      expect(result.proofBuffer).toBeDefined();
      expect(result.proofBuffer!.length).toBeGreaterThan(0);
    });

    it('returns non-empty publicInputsBuffer', async () => {
      const result = await prover.prove(source, { a: '3', b: '7' });
      expect(result.publicInputsBuffer).toBeDefined();
      expect(result.publicInputsBuffer!.length).toBeGreaterThan(0);
    });

    it('returns non-empty vkBuffer', async () => {
      const result = await prover.prove(source, { a: '3', b: '7' });
      expect(result.vkBuffer).toBeDefined();
      expect(result.vkBuffer!.length).toBeGreaterThan(0);
    });

    it('stderr is empty on success', async () => {
      const result = await prover.prove(source, { a: '3', b: '7' });
      expect(result.stderr).toBe('');
    });
  });

  describe('witness failure', () => {
    it('returns non-empty stderr when assertion fails (a=0 violates assert(a*b != 0))', async () => {
      const result = await prover.prove(source, { a: '0', b: '5' });
      expect(result.stderr).toBeTruthy();
      expect(result.proofBuffer).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('does not leave temp directories behind after a successful prove', async () => {
      const before = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith(PROVE_TEMP_DIR_PREFIX));
      await prover.prove(source, { a: '3', b: '7' });
      const after = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith(PROVE_TEMP_DIR_PREFIX));
      expect(after.length).toBeLessThanOrEqual(before.length);
    });

    it('does not leave temp directories behind after a prove failure', async () => {
      const before = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith(PROVE_TEMP_DIR_PREFIX));
      await prover.prove(source, { a: '0', b: '5' });
      const after = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith(PROVE_TEMP_DIR_PREFIX));
      expect(after.length).toBeLessThanOrEqual(before.length);
    });
  });
});
