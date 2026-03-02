import { compileNoir } from '@/lib/noir/compileNoir';
import { CompileSource } from '@/lib/circom/types';
import { MAX_SOURCE_BYTES } from '@/lib/noir/NoirServerCompiler';

jest.setTimeout(60_000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noirSource(content: string, filename = 'src/main.nr'): CompileSource {
  return {
    language: 'noir',
    files: [{ filename, content }],
    entrypoint: filename,
  };
}

// ─── Pre-validation tests (no nargo required) ─────────────────────────────────

describe('compileNoir (pre-validation)', () => {
  it('rejects an empty files array with a validation error', async () => {
    const source: CompileSource = { language: 'noir', files: [], entrypoint: 'src/main.nr' };
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/file/i);
    }
  });

  it('rejects when entrypoint is an empty string', async () => {
    const source: CompileSource = {
      language: 'noir',
      files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
      entrypoint: '',
    };
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
    }
  });

  it('rejects when entrypoint is not found in files', async () => {
    const source: CompileSource = {
      language: 'noir',
      files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
      entrypoint: 'src/other.nr',
    };
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/entrypoint/i);
    }
  });

  it('rejects when entrypoint file content is empty', async () => {
    const res = await compileNoir(noirSource(''));
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/empty/i);
    }
  });

  it('rejects whitespace-only entrypoint content', async () => {
    const res = await compileNoir(noirSource('   \n\t  '));
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
    }
  });

  it('rejects source that exceeds MAX_SOURCE_BYTES', async () => {
    const oversized = 'a'.repeat(MAX_SOURCE_BYTES + 1);
    const res = await compileNoir(noirSource(oversized));
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/exceeds/i);
    }
  });

  it('rejects when entrypoint does not end with .nr', async () => {
    const source: CompileSource = {
      language: 'noir',
      files: [{ filename: 'circuit.js', content: 'fn main() {}' }],
      entrypoint: 'circuit.js',
    };
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/\.nr/i);
    }
  });

  it('rejects when src/main.nr is not present in files', async () => {
    const source: CompileSource = {
      language: 'noir',
      files: [{ filename: 'lib/helper.nr', content: 'pub fn help() {}' }],
      entrypoint: 'lib/helper.nr',
    };
    const res = await compileNoir(source);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0].category).toBe('validation');
      expect(res.errors[0].message).toMatch(/src\/main\.nr/i);
    }
  });

  it('echoes back language: "noir" in the error response', async () => {
    const res = await compileNoir(noirSource(''));
    expect(res.language).toBe('noir');
  });

  it('allows source exactly at MAX_SOURCE_BYTES to pass validation', async () => {
    // If validation passes, nargo will fail (not installed), but no validation error
    const atLimit = 'a'.repeat(MAX_SOURCE_BYTES);
    const res = await compileNoir(noirSource(atLimit));
    // Either nargo failure or passes — but NOT a validation 'exceeds' error
    if (!res.success) {
      expect(res.errors[0].message).not.toMatch(/exceeds/i);
    }
  });
});
