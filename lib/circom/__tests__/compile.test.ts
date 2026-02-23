import { compileCircom } from '@/lib/circom/compileCircom';
import { mapCompileErrors, normalizeCompileOutput, parseConstraintCount, parseWireCount } from '@/lib/circom/normalize';
import { MAX_SOURCE_BYTES } from '@/lib/circom/CircomServerCompiler';
import { CircomCompileResult, CompileSource } from '@/lib/circom/types';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Narrow LanguageCompileResult to CircomCompileResult in tests. */
function asCircom(result: unknown): CircomCompileResult {
  return result as CircomCompileResult;
}

// ─── Fixture circuits ─────────────────────────────────────────────────────────

/** Minimal valid circuit — 1 constraint, works with the stub. */
const VALID_MULTIPLIER = `
pragma circom 2.0.0;
// constraints: 1
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}
component main = Multiplier();
`.trim();

/** Valid circuit with 3 constraints. */
const VALID_THREE_CONSTRAINTS = `
pragma circom 2.0.0;
// constraints: 3
template Adder3() {
    signal input a;
    signal input b;
    signal input c;
    signal output out;
    out <== a + b + c;
}
component main = Adder3();
`.trim();

/** Circuit that triggers the stub's syntax error path. */
const SYNTAX_ERROR_CIRCUIT = `
pragma circom 2.0.0;
__SYNTAX_ERROR__
template Bad() {}
component main = Bad();
`.trim();

/** Circuit that triggers the stub's semantic error path. */
const SEMANTIC_ERROR_CIRCUIT = `
pragma circom 2.0.0;
__SEMANTIC_ERROR__
template Bad() { signal input x; x === x; }
component main = Bad();
`.trim();

/** Shorthand: build a CompileSource for Circom. */
function circomSource(code: string, filename?: string): CompileSource {
  return { language: 'circom', code, filename };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('compileCircom', () => {
  // ── Success path ────────────────────────────────────────────────────────────

  describe('success path', () => {
    it('returns success:true for a valid single-file circuit', async () => {
      const response = await compileCircom(circomSource(VALID_MULTIPLIER));
      expect(response.success).toBe(true);
    });

    it('echoes back the language in the response', async () => {
      const response = await compileCircom(circomSource(VALID_MULTIPLIER));
      expect(response.language).toBe('circom');
    });

    it('returns the correct constraint count from stdout', async () => {
      const response = await compileCircom(circomSource(VALID_MULTIPLIER));
      expect(response.success).toBe(true);
      if (response.success) {
        expect(asCircom(response.result).constraintCount).toBe(1);
      }
    });

    it('returns constraint count of 3 for a 3-constraint circuit', async () => {
      const response = await compileCircom(circomSource(VALID_THREE_CONSTRAINTS));
      expect(response.success).toBe(true);
      if (response.success) {
        expect(asCircom(response.result).constraintCount).toBe(3);
      }
    });

    it('result contains a warnings array (empty for clean circuits)', async () => {
      const response = await compileCircom(circomSource(VALID_MULTIPLIER));
      expect(response.success).toBe(true);
      if (response.success) {
        expect(Array.isArray(asCircom(response.result).warnings)).toBe(true);
      }
    });
  });

  // ── Pre-validation ───────────────────────────────────────────────────────────

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

  // ── Error paths ──────────────────────────────────────────────────────────────

  describe('compiler error paths', () => {
    it('returns success:false with a syntax error on invalid circuit', async () => {
      const response = await compileCircom(circomSource(SYNTAX_ERROR_CIRCUIT));
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.errors.length).toBeGreaterThan(0);
        expect(response.errors[0].category).toBe('syntax');
      }
    });

    it('syntax error includes a line number', async () => {
      const response = await compileCircom(circomSource(SYNTAX_ERROR_CIRCUIT));
      if (!response.success) {
        expect(typeof response.errors[0].line).toBe('number');
      }
    });

    it('returns a semantic error for semantic violations', async () => {
      const response = await compileCircom(circomSource(SEMANTIC_ERROR_CIRCUIT));
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.errors[0].category).toBe('semantic');
      }
    });
  });
});

// ─── mapCompileErrors unit tests ─────────────────────────────────────────────

describe('mapCompileErrors', () => {
  it('returns empty array for empty stderr', () => {
    expect(mapCompileErrors('')).toEqual([]);
    expect(mapCompileErrors('   ')).toEqual([]);
  });

  it('classifies syntax errors (P-code) correctly', () => {
    const stderr = `error[P1002]: found: T_RBRACE\n --> circuit.circom:3:1\n  |\n3 | }\n  | ^`;
    const errors = mapCompileErrors(stderr);
    expect(errors[0].category).toBe('syntax');
    expect(errors[0].line).toBe(3);
    expect(errors[0].column).toBe(1);
  });

  it('classifies semantic errors (T-code) correctly', () => {
    const stderr = `error[T3001]: Variable x is not defined`;
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
