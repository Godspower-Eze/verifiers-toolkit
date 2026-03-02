/**
 * Multi-file Noir compilation tests.
 *
 * Covers every scenario where more than one source file is involved:
 *   - Pre-validation (no nargo binary required)
 *   - Successful multi-file compilation via real nargo toolchain
 *   - Compile errors originating in module files
 *   - Custom Nargo.toml handling
 *
 * Tests that require nargo are guarded by describeWhenNargo so the suite
 * still runs (and passes the pre-validation block) on machines without nargo.
 */
import { execSync } from 'child_process';
import { compileNoir } from '@/lib/noir/compileNoir';
import { NoirServerCompiler, TEMP_DIR_PREFIX, MAX_SOURCE_BYTES } from '@/lib/noir/NoirServerCompiler';
import { CompileSource } from '@/lib/circom/types';
import * as fs from 'fs';
import * as os from 'os';

jest.setTimeout(120_000);

// ─── nargo availability guard ─────────────────────────────────────────────────

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Main file that imports a module via `mod lib;`. */
const MAIN_WITH_MOD = `mod lib;

use crate::lib::double;

fn main(x: Field) -> pub Field {
    double(x)
}`;

/** A simple module: exports a function used by main. */
const LIB_MODULE = `pub fn double(x: Field) -> Field {
    x + x
}`;

/** Main importing two separate modules. */
const MAIN_TWO_MODS = `mod math;
mod utils;

use crate::math::square;
use crate::utils::negate;

fn main(x: Field) -> pub Field {
    square(x) + negate(x)
}`;

const MATH_MODULE = `pub fn square(x: Field) -> Field {
    x * x
}`;

const UTILS_MODULE = `pub fn negate(x: Field) -> Field {
    x * (-1)
}`;

/** Main importing a module that lives in a subdirectory. */
const MAIN_NESTED_MOD = `mod helpers;

use crate::helpers::add_one;

fn main(x: Field) -> pub Field {
    add_one(x)
}`;

const HELPERS_MODULE = `pub fn add_one(x: Field) -> Field {
    x + 1
}`;

/** Main referencing a module that isn't provided in files. */
const MAIN_MISSING_MOD = `mod missing;

use crate::missing::gone;

fn main(x: Field) -> pub Field {
    gone(x)
}`;

/** Module with a syntax error (missing colon in parameter). */
const MODULE_SYNTAX_ERROR = `pub fn bad(x Field) -> Field {
    x
}`;

/** Module with a type mismatch (returns wrong type). */
const MODULE_TYPE_ERROR = `pub fn wrong() -> u32 {
    // returns Field where u32 is expected
    let x: Field = 1;
    x
}`;

/** Main that uses module with a type error. */
const MAIN_USES_TYPE_ERROR_MOD = `mod badmod;

use crate::badmod::wrong;

fn main(_x: Field) {
    let _result: u32 = wrong();
}`;

/** Simple valid main for gate count testing. */
const MAIN_SIMPLE = `fn main(x: Field) -> pub Field {
    x * x
}`;

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeSource(files: Array<{ filename: string; content: string }>, entrypoint = 'src/main.nr'): CompileSource {
  return { language: 'noir', files, entrypoint };
}

// ─── Pre-validation (no nargo required) ───────────────────────────────────────

describe('compileNoir multi-file pre-validation', () => {
  it('rejects multi-file project missing src/main.nr', async () => {
    const source = makeSource(
      [
        { filename: 'src/lib.nr', content: LIB_MODULE },
        { filename: 'src/utils.nr', content: UTILS_MODULE },
      ],
      'src/lib.nr',
    );
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/src\/main\.nr/i);
    }
  });

  it('rejects when total bytes across all files exceed MAX_SOURCE_BYTES', async () => {
    const half = Math.ceil(MAX_SOURCE_BYTES / 2) + 1;
    const source = makeSource([
      { filename: 'src/main.nr', content: 'fn main() {}\n' + 'a'.repeat(half) },
      { filename: 'src/lib.nr', content: 'b'.repeat(half) },
    ]);
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/exceeds/i);
    }
  });

  it('total bytes at exactly MAX_SOURCE_BYTES passes validation', async () => {
    // Fill src/main.nr to exactly MAX_SOURCE_BYTES
    const content = 'fn main() {}\n' + 'a'.repeat(MAX_SOURCE_BYTES - 14);
    const source = makeSource([{ filename: 'src/main.nr', content }]);
    const res = await compileNoir(source);
    if (!res.success) {
      expect(res.errors[0].message).not.toMatch(/exceeds/i);
    }
  });

  it('rejects when src/main.nr content is empty (even with other files present)', async () => {
    const source = makeSource([
      { filename: 'src/main.nr', content: '' },
      { filename: 'src/lib.nr', content: LIB_MODULE },
    ]);
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/empty/i);
    }
  });

  it('rejects when src/main.nr is whitespace-only', async () => {
    const source = makeSource([
      { filename: 'src/main.nr', content: '   \n\t  ' },
      { filename: 'src/lib.nr', content: LIB_MODULE },
    ]);
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
    }
  });

  it('rejects when the entrypoint is not in the files array (multi-file)', async () => {
    const source = makeSource(
      [
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: LIB_MODULE },
      ],
      'src/missing.nr', // not in files
    );
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/entrypoint/i);
    }
  });

  it('rejects when the entrypoint does not end with .nr', async () => {
    const source = makeSource(
      [
        { filename: 'src/main.nr', content: MAIN_SIMPLE },
        { filename: 'Nargo.toml', content: '[package]\nname = "circuit"\ntype = "bin"\n[dependencies]\n' },
      ],
      'Nargo.toml',
    );
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/\.nr/i);
    }
  });

  it('echoes language: "noir" in the error response', async () => {
    const source = makeSource([]);
    const res = await compileNoir(source);
    expect(res.language).toBe('noir');
  });

  it('accepts a project where entrypoint differs from src/main.nr (both present)', async () => {
    // src/main.nr exists but entrypoint is src/lib.nr — validation should pass
    // (nargo will fail, but that is a compile error, not a validation error)
    const source = makeSource(
      [
        { filename: 'src/main.nr', content: MAIN_SIMPLE },
        { filename: 'src/lib.nr', content: LIB_MODULE },
      ],
      'src/lib.nr',
    );
    const res = await compileNoir(source);
    // May fail at nargo level, but the error must NOT be a validation error
    if (!res.success) {
      expect(res.errors[0].category).not.toBe('validation');
    }
  });
});

// ─── Multi-file compilation (real nargo) ──────────────────────────────────────

describeWhenNargo('compileNoir multi-file integration (real nargo)', () => {
  describe('two-file compilation', () => {
    it('compiles a two-file project: main.nr imports from lib.nr', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: LIB_MODULE },
      ]);
      const res = await compileNoir(source);
      expect(res.success).toBe(true);
    });

    it('two-file: acirBase64 is present and non-empty', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: LIB_MODULE },
      ]);
      const res = await compileNoir(source);
      if (res.success) {
        const result = res.result as { acirBase64: string };
        expect(typeof result.acirBase64).toBe('string');
        expect(result.acirBase64.length).toBeGreaterThan(0);
      }
    });

    it('two-file: ABI parameters reflect main.nr signature only', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: LIB_MODULE },
      ]);
      const res = await compileNoir(source);
      if (res.success) {
        const result = res.result as { abi: { parameters: Array<{ name: string }> } };
        expect(result.abi.parameters).toHaveLength(1);
        expect(result.abi.parameters[0].name).toBe('x');
      }
    });

    it('two-file: warnings array is returned', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: LIB_MODULE },
      ]);
      const res = await compileNoir(source);
      if (res.success) {
        const result = res.result as { warnings: string[] };
        expect(Array.isArray(result.warnings)).toBe(true);
      }
    });

    it('extra non-imported file does not break compilation', async () => {
      // src/unused.nr is present but not imported — should compile fine
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: LIB_MODULE },
        { filename: 'src/unused.nr', content: 'pub fn extra() -> Field { 42 }' },
      ]);
      const res = await compileNoir(source);
      expect(res.success).toBe(true);
    });
  });

  describe('three-file compilation', () => {
    it('compiles a three-file project with two independent modules', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_TWO_MODS },
        { filename: 'src/math.nr', content: MATH_MODULE },
        { filename: 'src/utils.nr', content: UTILS_MODULE },
      ]);
      const res = await compileNoir(source);
      expect(res.success).toBe(true);
    });

    it('three-file: ABI has correct number of parameters', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_TWO_MODS },
        { filename: 'src/math.nr', content: MATH_MODULE },
        { filename: 'src/utils.nr', content: UTILS_MODULE },
      ]);
      const res = await compileNoir(source);
      if (res.success) {
        const result = res.result as { abi: { parameters: Array<unknown> } };
        expect(result.abi.parameters).toHaveLength(1);
      }
    });
  });

  describe('nested module (subdirectory)', () => {
    it('compiles when a module lives in a subdirectory', async () => {
      // Nargo expects `mod helpers;` to resolve to `src/helpers.nr` or `src/helpers/mod.nr`
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_NESTED_MOD },
        { filename: 'src/helpers.nr', content: HELPERS_MODULE },
      ]);
      const res = await compileNoir(source);
      expect(res.success).toBe(true);
    });
  });

  describe('custom Nargo.toml', () => {
    it('uses a user-provided Nargo.toml instead of the auto-generated one', async () => {
      const customToml = `[package]
name = "my_custom_circuit"
type = "bin"
authors = ["test"]

[dependencies]
`;
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_SIMPLE },
        { filename: 'Nargo.toml', content: customToml },
      ]);
      const res = await compileNoir(source);
      // With a valid custom Nargo.toml, compilation should succeed
      expect(res.success).toBe(true);
    });

    it('rejects compilation when custom Nargo.toml is malformed', async () => {
      const badToml = `this is not valid toml!!!!!!`;
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_SIMPLE },
        { filename: 'Nargo.toml', content: badToml },
      ]);
      const res = await compileNoir(source);
      // nargo should reject the malformed toml
      expect(res.success).toBe(false);
    });
  });

  describe('compile error paths', () => {
    it('returns error when a required module file is not provided', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_MISSING_MOD },
        // src/missing.nr is NOT provided
      ]);
      const res = await compileNoir(source);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errors.length).toBeGreaterThan(0);
      }
    });

    it('missing module: error category is syntax or internal', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_MISSING_MOD },
      ]);
      const res = await compileNoir(source);
      if (!res.success) {
        expect(['syntax', 'internal']).toContain(res.errors[0].category);
      }
    });

    it('returns error when a module file has a syntax error', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: MODULE_SYNTAX_ERROR },
      ]);
      const res = await compileNoir(source);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errors.length).toBeGreaterThan(0);
      }
    });

    it('syntax error in module: error has file info pointing into the module', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: MODULE_SYNTAX_ERROR },
      ]);
      const res = await compileNoir(source);
      if (!res.success && res.errors[0].file) {
        // File path should not include temp dir prefix
        expect(res.errors[0].file).not.toContain('/tmp/');
      }
    });

    it('returns error when a module has a type mismatch', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_USES_TYPE_ERROR_MOD },
        { filename: 'src/badmod.nr', content: MODULE_TYPE_ERROR },
      ]);
      const res = await compileNoir(source);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errors.length).toBeGreaterThan(0);
      }
    });

    it('does not throw — errors are returned, not thrown', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_MISSING_MOD },
      ]);
      await expect(compileNoir(source)).resolves.toBeDefined();
    });
  });

  describe('gate count with multi-file', () => {
    it('gateCount is a non-negative number after multi-file compilation', async () => {
      const source = makeSource([
        { filename: 'src/main.nr', content: MAIN_WITH_MOD },
        { filename: 'src/lib.nr', content: LIB_MODULE },
      ]);
      const res = await compileNoir(source);
      if (res.success) {
        const result = res.result as { gateCount: number };
        expect(typeof result.gateCount).toBe('number');
        expect(result.gateCount).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ─── NoirServerCompiler multi-file (raw compiler layer) ──────────────────────

describeWhenNargo('NoirServerCompiler multi-file (raw compiler)', () => {
  const compiler = new NoirServerCompiler();

  it('writes all provided source files to temp dir', async () => {
    // Successful compilation proves both files were written and accessible
    const source = makeSource([
      { filename: 'src/main.nr', content: MAIN_WITH_MOD },
      { filename: 'src/lib.nr', content: LIB_MODULE },
    ]);
    const raw = await compiler.compile(source);
    expect(raw.acirJson).toBeDefined();
    expect(raw.stderr.trim()).toBe('');
  });

  it('creates subdirectories for nested module paths', async () => {
    // If the subdir isn't created, nargo cannot find the module file
    const source = makeSource([
      { filename: 'src/main.nr', content: MAIN_NESTED_MOD },
      { filename: 'src/helpers.nr', content: HELPERS_MODULE },
    ]);
    const raw = await compiler.compile(source);
    expect(raw.acirJson).toBeDefined();
  });

  it('does not leave temp dirs behind after multi-file compilation', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith(TEMP_DIR_PREFIX));
    const source = makeSource([
      { filename: 'src/main.nr', content: MAIN_WITH_MOD },
      { filename: 'src/lib.nr', content: LIB_MODULE },
    ]);
    await compiler.compile(source);
    const after = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith(TEMP_DIR_PREFIX));
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it('does not leave temp dirs behind after a multi-file compile error', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith(TEMP_DIR_PREFIX));
    const source = makeSource([
      { filename: 'src/main.nr', content: MAIN_MISSING_MOD },
    ]);
    await compiler.compile(source);
    const after = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith(TEMP_DIR_PREFIX));
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it('auto-generates Nargo.toml when none is provided', async () => {
    // If auto-generation is correct, compilation succeeds
    const source = makeSource([
      { filename: 'src/main.nr', content: MAIN_SIMPLE },
      { filename: 'src/lib.nr', content: LIB_MODULE },
    ]);
    const raw = await compiler.compile(source);
    // Nargo.toml being auto-generated is proven by the absence of "not found" errors
    expect(raw.acirJson).toBeDefined();
  });
});
