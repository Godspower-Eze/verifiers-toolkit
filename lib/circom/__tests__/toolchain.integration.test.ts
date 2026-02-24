/**
 * Feature 02 integration tests — Real circom compiler via @distributedlab/circom2
 *
 * These tests call CircomServerCompiler with REAL compilation (no stubs).
 * They run against the actual @distributedlab/circom2 toolchain.
 * Jest timeout is extended because real compilation takes a few seconds.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CircomServerCompiler } from '@/lib/circom/CircomServerCompiler';
import { CompileSource } from '@/lib/circom/types';

jest.setTimeout(60_000); // real compilation can take up to 30s

// ─── Fixture circuits ─────────────────────────────────────────────────────────

/** Smallest valid Groth16 circuit: 1 non-linear constraint. */
const MULTIPLIER_CIRCUIT = `
pragma circom 2.0.0;
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}
component main {public [a]} = Multiplier();
`.trim();

/** Two-step multiplication: 2 non-linear constraints. */
const DOUBLE_MULTIPLIER_CIRCUIT = `
pragma circom 2.0.0;
template DoubleMultiplier() {
    signal input a;
    signal input b;
    signal input c;
    signal output out;
    signal ab;
    ab <== a * b;
    out <== ab * c;
}
component main {public [a]} = DoubleMultiplier();
`.trim();

/** Syntax error: missing closing brace. */
const SYNTAX_ERROR_CIRCUIT = `
pragma circom 2.0.0;
template Bad() {
    signal input a;
    signal output b;
    b <== a * a;
component main = Bad();
`.trim();

/** Semantic error: undeclared signal used. */
const SEMANTIC_ERROR_CIRCUIT = `
pragma circom 2.0.0;
template Bad() {
    signal input a;
    signal output b;
    b <== a * undeclaredSignal;
}
component main = Bad();
`.trim();

function circomSource(code: string): CompileSource {
  return { language: 'circom', code };
}

// ─── Real compiler tests ──────────────────────────────────────────────────────

describe('CircomServerCompiler (real toolchain)', () => {
  const compiler = new CircomServerCompiler();

  describe('successful compilation', () => {
    it('compiles a valid multiplier circuit and returns stdout', async () => {
      const result = await compiler.compile(circomSource(MULTIPLIER_CIRCUIT));
      expect(result.stderr).toBe('');
      expect(result.stdout).toBeTruthy();
    });

    it('produces a non-empty R1CS artifact buffer', async () => {
      const result = await compiler.compile(circomSource(MULTIPLIER_CIRCUIT));
      expect(result.artifactBuffer).toBeDefined();
      expect((result.artifactBuffer as Buffer).length).toBeGreaterThan(0);
    });

    it('stdout contains constraint count information', async () => {
      const result = await compiler.compile(circomSource(MULTIPLIER_CIRCUIT));
      // circom outputs non-linear constraint count
      expect(result.stdout).toMatch(/constraint/i);
    });

    it('reports 2 constraints for the double-multiplier circuit', async () => {
      const result = await compiler.compile(circomSource(DOUBLE_MULTIPLIER_CIRCUIT));
      expect(result.stderr).toBe('');
      // normalizeCompileOutput will parse this; here we just check raw stdout
      expect(result.stdout).toMatch(/non[- ]linear constraints:\s*2/i);
    });
  });

  describe('error paths', () => {
    it('returns non-empty stderr for a syntax error', async () => {
      const result = await compiler.compile(circomSource(SYNTAX_ERROR_CIRCUIT));
      expect(result.stderr.trim()).not.toBe('');
    });

    it('stderr for syntax error contains "error"', async () => {
      const result = await compiler.compile(circomSource(SYNTAX_ERROR_CIRCUIT));
      expect(result.stderr.toLowerCase()).toContain('error');
    });

    it('returns non-empty stderr for a semantic error', async () => {
      const result = await compiler.compile(circomSource(SEMANTIC_ERROR_CIRCUIT));
      expect(result.stderr.trim()).not.toBe('');
    });

    it('does not throw — errors are returned in stderr, not thrown', async () => {
      await expect(compiler.compile(circomSource(SYNTAX_ERROR_CIRCUIT))).resolves.toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('does not leave temp directories behind after successful compile', async () => {
      const tempRootBefore = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('circom-'));
      await compiler.compile(circomSource(MULTIPLIER_CIRCUIT));
      const tempRootAfter = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('circom-'));
      // Any temp dirs created during compile should be gone
      expect(tempRootAfter.length).toBeLessThanOrEqual(tempRootBefore.length);
    });

    it('does not leave temp directories behind after a compile error', async () => {
      const tempRootBefore = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('circom-'));
      await compiler.compile(circomSource(SYNTAX_ERROR_CIRCUIT));
      const tempRootAfter = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('circom-'));
      expect(tempRootAfter.length).toBeLessThanOrEqual(tempRootBefore.length);
    });
  });
});

// ─── End-to-end via compileCircom ─────────────────────────────────────────────

describe('compileCircom (end-to-end, real toolchain)', () => {
  it('returns success:true and correct constraintCount for multiplier', async () => {
    const { compileCircom } = await import('@/lib/circom/compileCircom');
    const response = await compileCircom(circomSource(MULTIPLIER_CIRCUIT));
    expect(response.success).toBe(true);
    if (response.success) {
      const result = response.result as { constraintCount: number };
      expect(result.constraintCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns success:false and a CompileError for a syntax error', async () => {
    const { compileCircom } = await import('@/lib/circom/compileCircom');
    const response = await compileCircom(circomSource(SYNTAX_ERROR_CIRCUIT));
    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.errors.length).toBeGreaterThan(0);
      expect(['syntax', 'semantic', 'internal']).toContain(response.errors[0].category);
    }
  });
});
