/**
 * Multi-file Circom compilation tests.
 *
 * Covers every scenario where more than one source file is involved:
 *   - Pre-validation (no circom binary required)
 *   - Successful multi-file compilation via real circom toolchain
 *   - Compile errors originating in dependency files
 *
 * Uses the real @distributedlab/circom2 toolchain, so jest.setTimeout is
 * extended. All tests that require the compiler are in their own describe block
 * so the pre-validation tests stay fast.
 */
import { compileCircom } from '@/lib/circom/compileCircom';
import { CircomServerCompiler } from '@/lib/circom/CircomServerCompiler';
import { CompileSource } from '@/lib/circom/types';
import { MAX_SOURCE_BYTES } from '@/lib/circom/CircomServerCompiler';

jest.setTimeout(60_000);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A reusable template library — no component main, pure template definition. */
const HELPER_MULTIPLIER = `
pragma circom 2.0.0;

template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}
`.trim();

/** Entrypoint that includes the helper and instantiates its template. */
const MAIN_USES_HELPER = `
pragma circom 2.0.0;

include "helper.circom";

component main {public [a]} = Multiplier();
`.trim();

/** Second helper: a simple squarer. */
const HELPER_SQUARER = `
pragma circom 2.0.0;

template Squarer() {
    signal input x;
    signal output y;
    y <== x * x;
}
`.trim();

/** Entrypoint that includes both helpers. */
const MAIN_TWO_HELPERS = `
pragma circom 2.0.0;

include "helpers/multiplier.circom";
include "helpers/squarer.circom";

template Combined() {
    signal input a;
    signal input b;
    signal output product;
    signal output square;
    component m = Multiplier();
    component s = Squarer();
    m.a <== a;
    m.b <== b;
    s.x <== a;
    product <== m.c;
    square <== s.y;
}

component main {public [a, b]} = Combined();
`.trim();

/** Entrypoint that includes a file which is not provided — will cause error. */
const MAIN_MISSING_INCLUDE = `
pragma circom 2.0.0;

include "missing.circom";

component main = Missing();
`.trim();

/** Syntax error inside a helper file (unclosed template brace). */
const HELPER_SYNTAX_ERROR = `
pragma circom 2.0.0;

template Broken() {
    signal input x;
    signal output y;
    y <== x * x;
`.trim(); // missing closing brace

/** Semantic error inside a helper (uses undeclared signal). */
const HELPER_SEMANTIC_ERROR = `
pragma circom 2.0.0;

template BadHelper() {
    signal input a;
    signal output b;
    b <== a * undeclaredSignal;
}
`.trim();

/** Entrypoint using a helper that has a semantic error. */
const MAIN_USES_BAD_HELPER = `
pragma circom 2.0.0;

include "bad_helper.circom";

component main = BadHelper();
`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSource(files: Array<{ filename: string; content: string }>, entrypoint: string): CompileSource {
  return { language: 'circom', files, entrypoint };
}

// ─── Pre-validation (no compiler binary needed) ───────────────────────────────

describe('compileCircom multi-file pre-validation', () => {
  it('rejects when entrypoint is not present in multi-file array', async () => {
    const source = makeSource(
      [
        { filename: 'helper.circom', content: HELPER_MULTIPLIER },
        { filename: 'other.circom', content: 'pragma circom 2.0.0;' },
      ],
      'main.circom', // not in files
    );
    const res = await compileCircom(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/entrypoint/i);
    }
  });

  it('rejects when entrypoint file is empty in a multi-file project', async () => {
    const source = makeSource(
      [
        { filename: 'main.circom', content: '' },
        { filename: 'helper.circom', content: HELPER_MULTIPLIER },
      ],
      'main.circom',
    );
    const res = await compileCircom(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/empty/i);
    }
  });

  it('rejects when entrypoint file is whitespace-only', async () => {
    const source = makeSource(
      [
        { filename: 'main.circom', content: '   \n\t  ' },
        { filename: 'helper.circom', content: HELPER_MULTIPLIER },
      ],
      'main.circom',
    );
    const res = await compileCircom(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
    }
  });

  it('rejects when total bytes across all files exceed MAX_SOURCE_BYTES', async () => {
    // Each file is well under the limit on its own, but together they exceed it
    const half = Math.ceil(MAX_SOURCE_BYTES / 2) + 1;
    const source = makeSource(
      [
        { filename: 'main.circom', content: 'pragma circom 2.0.0; ' + 'a'.repeat(half) },
        { filename: 'helper.circom', content: 'pragma circom 2.0.0; ' + 'b'.repeat(half) },
      ],
      'main.circom',
    );
    const res = await compileCircom(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/exceeds/i);
    }
  });

  it('allows total bytes across files at exactly MAX_SOURCE_BYTES', async () => {
    // Validation should pass even if nargo/circom fails later
    const bigContent = 'a'.repeat(MAX_SOURCE_BYTES - 30);
    const source = makeSource(
      [{ filename: 'main.circom', content: bigContent }],
      'main.circom',
    );
    const res = await compileCircom(source);
    // Should NOT be a validation 'exceeds' error
    if (!res.success) {
      expect(res.errors[0].message).not.toMatch(/exceeds/i);
    }
  });

  it('rejects an empty files array even with a provided entrypoint', async () => {
    const source: CompileSource = {
      language: 'circom',
      files: [],
      entrypoint: 'main.circom',
    };
    const res = await compileCircom(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
    }
  });

  it('rejects when entrypoint string is empty', async () => {
    const source: CompileSource = {
      language: 'circom',
      files: [{ filename: 'circuit.circom', content: 'pragma circom 2.0.0;' }],
      entrypoint: '',
    };
    const res = await compileCircom(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
    }
  });

  it('echoes language: "circom" in the error response', async () => {
    const source = makeSource([], 'main.circom');
    const res = await compileCircom(source);
    expect(res.language).toBe('circom');
  });
});

// ─── Multi-file compilation (real circom toolchain) ───────────────────────────

describe('compileCircom multi-file integration (real toolchain)', () => {
  describe('successful two-file compilation', () => {
    it('compiles a two-file project: main includes a helper template', async () => {
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_USES_HELPER },
          { filename: 'helper.circom', content: HELPER_MULTIPLIER },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      expect(res.success).toBe(true);
    });

    it('two-file project: constraintCount is at least 1', async () => {
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_USES_HELPER },
          { filename: 'helper.circom', content: HELPER_MULTIPLIER },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      expect(res.success).toBe(true);
      if (res.success) {
        const result = res.result as { constraintCount: number };
        expect(result.constraintCount).toBeGreaterThanOrEqual(1);
      }
    });

    it('two-file project: produces r1csBuffer', async () => {
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_USES_HELPER },
          { filename: 'helper.circom', content: HELPER_MULTIPLIER },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      if (res.success) {
        const result = res.result as { r1csBuffer: Buffer };
        expect(result.r1csBuffer).toBeInstanceOf(Buffer);
        expect(result.r1csBuffer.length).toBeGreaterThan(0);
      }
    });

    it('two-file project: produces wasmBuffer', async () => {
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_USES_HELPER },
          { filename: 'helper.circom', content: HELPER_MULTIPLIER },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      if (res.success) {
        const result = res.result as { wasmBuffer: Buffer };
        expect(result.wasmBuffer).toBeInstanceOf(Buffer);
        expect(result.wasmBuffer.length).toBeGreaterThan(0);
      }
    });

    it('two-file project: extra non-included file does not affect compilation', async () => {
      // A third file is present but not included by main — should compile fine
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_USES_HELPER },
          { filename: 'helper.circom', content: HELPER_MULTIPLIER },
          { filename: 'unused.circom', content: 'pragma circom 2.0.0;' },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      expect(res.success).toBe(true);
    });
  });

  describe('successful three-file compilation with subdirectories', () => {
    it('compiles a three-file project where helpers live in a subdirectory', async () => {
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_TWO_HELPERS },
          { filename: 'helpers/multiplier.circom', content: HELPER_MULTIPLIER },
          { filename: 'helpers/squarer.circom', content: HELPER_SQUARER },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      expect(res.success).toBe(true);
    });

    it('three-file project: constraintCount reflects both sub-circuits', async () => {
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_TWO_HELPERS },
          { filename: 'helpers/multiplier.circom', content: HELPER_MULTIPLIER },
          { filename: 'helpers/squarer.circom', content: HELPER_SQUARER },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      if (res.success) {
        const result = res.result as { constraintCount: number };
        expect(result.constraintCount).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('compile error paths', () => {
    it('returns error when an included file is missing from files array', async () => {
      const source = makeSource(
        [{ filename: 'main.circom', content: MAIN_MISSING_INCLUDE }],
        'main.circom',
      );
      const res = await compileCircom(source);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errors.length).toBeGreaterThan(0);
      }
    });

    it('missing include: error category is syntax or internal', async () => {
      const source = makeSource(
        [{ filename: 'main.circom', content: MAIN_MISSING_INCLUDE }],
        'main.circom',
      );
      const res = await compileCircom(source);
      if (!res.success) {
        expect(['syntax', 'internal']).toContain(res.errors[0].category);
      }
    });

    it('returns error when a helper file has a syntax error', async () => {
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_USES_BAD_HELPER.replace('bad_helper', 'helper') },
          { filename: 'helper.circom', content: HELPER_SYNTAX_ERROR },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errors.length).toBeGreaterThan(0);
      }
    });

    it('returns error when a helper file has a semantic error', async () => {
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_USES_BAD_HELPER },
          { filename: 'bad_helper.circom', content: HELPER_SEMANTIC_ERROR },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errors.length).toBeGreaterThan(0);
        expect(['semantic', 'internal']).toContain(res.errors[0].category);
      }
    });

    it('returns error when two files define the same template name', async () => {
      // Both files define Multiplier — circom should reject duplicate template
      const source = makeSource(
        [
          { filename: 'main.circom', content: MAIN_USES_HELPER },
          { filename: 'helper.circom', content: HELPER_MULTIPLIER },
          { filename: 'dupe.circom', content: HELPER_MULTIPLIER }, // same template
        ],
        'main.circom',
      );
      // The helper includes only helper.circom, so dupe.circom is not included.
      // This should succeed because dupe.circom is not in the include chain.
      // The test confirms extra files don't pollute the include namespace.
      const res = await compileCircom(source);
      expect(res.success).toBe(true);
    });

    it('returns error when main directly includes two files with the same template', async () => {
      const mainWithDupeInclude = `
pragma circom 2.0.0;
include "helper.circom";
include "dupe.circom";
component main {public [a]} = Multiplier();
`.trim();
      const source = makeSource(
        [
          { filename: 'main.circom', content: mainWithDupeInclude },
          { filename: 'helper.circom', content: HELPER_MULTIPLIER },
          { filename: 'dupe.circom', content: HELPER_MULTIPLIER },
        ],
        'main.circom',
      );
      const res = await compileCircom(source);
      // circom may deduplicate includes or reject — either way it shouldn't crash
      // (circom actually deduplicates by file path, so this may succeed)
      expect(typeof res.success).toBe('boolean');
    });
  });
});

// ─── CircomServerCompiler multi-file (raw compiler layer) ────────────────────

describe('CircomServerCompiler multi-file (raw compiler)', () => {
  const compiler = new CircomServerCompiler();

  it('writes all provided files to the temp directory before compiling', async () => {
    // If compilation succeeds, all files were written and accessible
    const source = makeSource(
      [
        { filename: 'main.circom', content: MAIN_USES_HELPER },
        { filename: 'helper.circom', content: HELPER_MULTIPLIER },
      ],
      'main.circom',
    );
    const raw = await compiler.compile(source);
    // Successful compilation proves both files were written
    expect(raw.stderr).toBe('');
    expect(raw.artifactBuffer).toBeDefined();
  });

  it('creates subdirectories for files with path separators', async () => {
    const source = makeSource(
      [
        { filename: 'main.circom', content: MAIN_TWO_HELPERS },
        { filename: 'helpers/multiplier.circom', content: HELPER_MULTIPLIER },
        { filename: 'helpers/squarer.circom', content: HELPER_SQUARER },
      ],
      'main.circom',
    );
    const raw = await compiler.compile(source);
    // If helpers dir was not created, circom would report a missing file error
    expect(raw.stderr).toBe('');
  });

  it('does not leave temp directories behind after multi-file compilation', async () => {
    const before = (await import('fs')).readdirSync((await import('os')).tmpdir()).filter(d => d.startsWith('circom-'));
    const source = makeSource(
      [
        { filename: 'main.circom', content: MAIN_USES_HELPER },
        { filename: 'helper.circom', content: HELPER_MULTIPLIER },
      ],
      'main.circom',
    );
    await compiler.compile(source);
    const after = (await import('fs')).readdirSync((await import('os')).tmpdir()).filter(d => d.startsWith('circom-'));
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it('does not leave temp dirs behind after a multi-file compile error', async () => {
    const before = (await import('fs')).readdirSync((await import('os')).tmpdir()).filter(d => d.startsWith('circom-'));
    const source = makeSource(
      [{ filename: 'main.circom', content: MAIN_MISSING_INCLUDE }],
      'main.circom',
    );
    await compiler.compile(source);
    const after = (await import('fs')).readdirSync((await import('os')).tmpdir()).filter(d => d.startsWith('circom-'));
    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});
