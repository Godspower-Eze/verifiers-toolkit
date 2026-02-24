import { compileCircom } from '@/lib/circom/compileCircom';
import { mapCompileErrors, normalizeCompileOutput, parseConstraintCount, parseWireCount } from '@/lib/circom/normalize';
import { MAX_SOURCE_BYTES } from '@/lib/circom/CircomServerCompiler';
import { CircomCompileResult, CompileSource } from '@/lib/circom/types';

jest.setTimeout(60_000); // real compilation may take a few seconds

// ─── Helper ───────────────────────────────────────────────────────────────────

function asCircom(result: unknown): CircomCompileResult {
  return result as CircomCompileResult;
}

function circomSource(code: string, filename?: string): CompileSource {
  return { language: 'circom', code, filename };
}

// ─── Fixture circuits ─────────────────────────────────────────────────────────

/** Minimal valid Groth16 circuit: 1 non-linear constraint. */
const VALID_MULTIPLIER = `
pragma circom 2.0.0;
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}
component main {public [a]} = Multiplier();
`.trim();

/** Three-signal adder: 2 non-linear constraints. */
const VALID_THREE_CONSTRAINTS = `
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

/** Real circom syntax error: missing closing brace. */
const SYNTAX_ERROR_CIRCUIT = `
pragma circom 2.0.0;
template Bad() {
    signal input a;
    signal output b;
    b <== a * a;
component main = Bad();
`.trim();

/** Real circom semantic error: undeclared signal. */
const SEMANTIC_ERROR_CIRCUIT = `
pragma circom 2.0.0;
template Bad() {
    signal input a;
    signal output b;
    b <== a * unknownSignal;
}
component main = Bad();
`.trim();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('compileCircom', () => {
  describe('success path', () => {
    it('returns success:true for a valid single-file circuit', async () => {
      const response = await compileCircom(circomSource(VALID_MULTIPLIER));
      expect(response.success).toBe(true);
    });

    it('echoes back the language in the response', async () => {
      const response = await compileCircom(circomSource(VALID_MULTIPLIER));
      expect(response.language).toBe('circom');
    });

    it('returns at least 1 constraint for multiplier', async () => {
      const response = await compileCircom(circomSource(VALID_MULTIPLIER));
      expect(response.success).toBe(true);
      if (response.success) {
        expect(asCircom(response.result).constraintCount).toBeGreaterThanOrEqual(1);
      }
    });

    it('returns at least 2 constraints for a 2-constraint circuit', async () => {
      const response = await compileCircom(circomSource(VALID_THREE_CONSTRAINTS));
      expect(response.success).toBe(true);
      if (response.success) {
        expect(asCircom(response.result).constraintCount).toBeGreaterThanOrEqual(2);
      }
    });

    it('result contains a warnings array', async () => {
      const response = await compileCircom(circomSource(VALID_MULTIPLIER));
      expect(response.success).toBe(true);
      if (response.success) {
        expect(Array.isArray(asCircom(response.result).warnings)).toBe(true);
      }
    });
  });

  describe('pre-validation', () => {
    it('rejects empty source with a validation error', async () => {
      const response = await compileCircom(circomSource(''));
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.errors[0].category).toBe('validation');
        expect(response.errors[0].message).toMatch(/empty/i);
      }
    });

    it('rejects whitespace-only source with a validation error', async () => {
      const response = await compileCircom(circomSource('   \n\t  '));
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.errors[0].category).toBe('validation');
      }
    });

    it('rejects source that exceeds MAX_SOURCE_BYTES', async () => {
      const oversized = 'a'.repeat(MAX_SOURCE_BYTES + 1);
      const response = await compileCircom(circomSource(oversized));
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.errors[0].category).toBe('validation');
        expect(response.errors[0].message).toMatch(/exceeds/i);
      }
    });
  });

  describe('compiler error paths', () => {
    it('returns success:false for a syntax error circuit', async () => {
      const response = await compileCircom(circomSource(SYNTAX_ERROR_CIRCUIT));
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.errors.length).toBeGreaterThan(0);
      }
    });

    it('syntax error has a recognised category', async () => {
      const response = await compileCircom(circomSource(SYNTAX_ERROR_CIRCUIT));
      if (!response.success) {
        expect(['syntax', 'internal']).toContain(response.errors[0].category);
      }
    });

    it('returns success:false for a semantic error circuit', async () => {
      const response = await compileCircom(circomSource(SEMANTIC_ERROR_CIRCUIT));
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(['semantic', 'internal']).toContain(response.errors[0].category);
      }
    });
  });
});

// ─── mapCompileErrors unit tests (pattern matching against real stderr) ────────

describe('mapCompileErrors', () => {
  it('returns empty array for empty stderr', () => {
    expect(mapCompileErrors('')).toEqual([]);
    expect(mapCompileErrors('   ')).toEqual([]);
  });

  it('classifies P-code syntax errors with box-drawing location block', () => {
    const stderr = [
      'error[P1012]: UnrecognizedEOF { location: 119 }',
      '  \u250c\u2500 "/tmp/circom-abc/bad.circom":3:1',
      '  \u2502',
      '3 \u2502 pragma circom 2.0.0;',
      '  \u2502 ^ here',
    ].join('\n');
    const errors = mapCompileErrors(stderr);
    expect(errors[0].category).toBe('syntax');
    expect(errors[0].line).toBe(3);
    expect(errors[0].column).toBe(1);
  });

  it('classifies P-code syntax errors without location as syntax', () => {
    const stderr = 'error[P1001]: unexpected token';
    const errors = mapCompileErrors(stderr);
    expect(errors[0].category).toBe('syntax');
  });

  it('classifies T-code semantic errors with location block', () => {
    const stderr = [
      'error[T3001]: Undefined variable x',
      '  \u250c\u2500 "/tmp/circom-abc/bad.circom":5:10',
    ].join('\n');
    const errors = mapCompileErrors(stderr);
    expect(errors[0].category).toBe('semantic');
    expect(errors[0].line).toBe(5);
  });

  it('classifies T-code semantic errors without location as semantic', () => {
    const stderr = 'error[T3001]: Variable x is not defined';
    const errors = mapCompileErrors(stderr);
    expect(errors[0].category).toBe('semantic');
  });

  it('falls back to internal category for unknown errors', () => {
    const stderr = 'something went very wrong';
    const errors = mapCompileErrors(stderr);
    expect(errors[0].category).toBe('internal');
    expect(errors[0].message).toBeTruthy();
  });
});

// ─── normalizeCompileOutput unit tests ───────────────────────────────────────

describe('normalizeCompileOutput', () => {
  it('extracts non-linear constraint count from stdout', () => {
    const raw = { stdout: 'non linear constraints: 42\ntotal wires: 44', stderr: '' };
    const result = normalizeCompileOutput(raw);
    expect(result.constraintCount).toBe(42);
    expect(result.wireCount).toBe(44);
  });

  it('returns 0 constraint count when stdout has no match', () => {
    const raw = { stdout: 'compilation started', stderr: '' };
    const result = normalizeCompileOutput(raw);
    expect(result.constraintCount).toBe(0);
  });

  it('extracts warnings from stdout lines', () => {
    const raw = { stdout: 'warning: unused signal\nnon linear constraints: 1', stderr: '' };
    const result = normalizeCompileOutput(raw);
    expect(result.warnings).toContain('warning: unused signal');
  });
});

// ─── parseConstraintCount / parseWireCount ────────────────────────────────────

describe('parseConstraintCount', () => {
  it('matches "non linear constraints: N"', () => {
    expect(parseConstraintCount('non linear constraints: 7')).toBe(7);
  });
  it('matches "Total number of constraints: N"', () => {
    expect(parseConstraintCount('Total number of constraints: 99')).toBe(99);
  });
  it('returns 0 when no match', () => {
    expect(parseConstraintCount('')).toBe(0);
  });
});

describe('parseWireCount', () => {
  it('returns wire count when present', () => {
    expect(parseWireCount('total wires: 5')).toBe(5);
  });
  it('returns undefined when not present', () => {
    expect(parseWireCount('no wires here')).toBeUndefined();
  });
});
