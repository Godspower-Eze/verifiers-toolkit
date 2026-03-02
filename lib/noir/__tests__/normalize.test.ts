import { mapNoirErrors, normalizeNoirOutput } from '@/lib/noir/normalize';
import { RawNoirOutput } from '@/lib/noir/NoirServerCompiler';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rawWith(acirJson: string, opts: { stdout?: string; stderr?: string } = {}): RawNoirOutput {
  return { stdout: opts.stdout ?? '', stderr: opts.stderr ?? '', acirJson };
}

function makeAcirJson(
  abi: object = { parameters: [], return_type: null },
  bytecode = 'dGVzdA==',
): string {
  return JSON.stringify({ bytecode, abi });
}

// ─── mapNoirErrors ─────────────────────────────────────────────────────────────

describe('mapNoirErrors', () => {
  it('returns empty array for empty stderr', () => {
    expect(mapNoirErrors('')).toEqual([]);
  });

  it('returns empty array for whitespace-only stderr', () => {
    expect(mapNoirErrors('   \n\t  ')).toEqual([]);
  });

  it('classifies nargo error+location as syntax with correct line and column', () => {
    const stderr = [
      'error: Expected an identifier, found end of input',
      '   \u250c\u2500 src/main.nr:3:5',
      '   \u2502',
      ' 3 \u2502     fn bad(',
    ].join('\n');
    const errors = mapNoirErrors(stderr);
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe('syntax');
    expect(errors[0].line).toBe(3);
    expect(errors[0].column).toBe(5);
    expect(errors[0].file).toBe('src/main.nr');
  });

  it('includes the error message text', () => {
    const stderr = [
      'error: Expected an identifier, found end of input',
      '   \u250c\u2500 src/main.nr:1:10',
    ].join('\n');
    const errors = mapNoirErrors(stderr);
    expect(errors[0].message).toContain('Expected an identifier');
  });

  it('classifies bare "error: ..." without location as syntax', () => {
    const stderr = 'error: cannot find value `missing_var` in this scope';
    const errors = mapNoirErrors(stderr);
    expect(errors[0].category).toBe('syntax');
    expect(errors[0].message).toContain('cannot find value');
    expect(errors[0].line).toBeUndefined();
    expect(errors[0].file).toBeUndefined();
  });

  it('falls back to internal category for non-error stderr', () => {
    const stderr = 'nargo: command not found';
    const errors = mapNoirErrors(stderr);
    expect(errors[0].category).toBe('internal');
    expect(errors[0].message).toBeTruthy();
  });

  it('strips temp dir prefix from file path', () => {
    const stderr = [
      'error: type mismatch',
      '   \u250c\u2500 /tmp/noir-abc123/src/main.nr:7:3',
    ].join('\n');
    const errors = mapNoirErrors(stderr);
    expect(errors[0].file).toBe('src/main.nr');
    expect(errors[0].file).not.toContain('/tmp/');
  });

  it('strips OS tmpdir path variants from file path', () => {
    const stderr = [
      'error: expected type',
      '   \u250c\u2500 /var/folders/xx/noir-xyz789/src/helpers.nr:2:1',
    ].join('\n');
    const errors = mapNoirErrors(stderr);
    expect(errors[0].file).toBe('src/helpers.nr');
  });
});

// ─── normalizeNoirOutput ───────────────────────────────────────────────────────

describe('normalizeNoirOutput', () => {
  it('throws when acirJson is missing', () => {
    expect(() => normalizeNoirOutput({ stdout: '', stderr: '' })).toThrow();
  });

  it('sets gateCount to 0 (nargo v1 does not expose it directly)', () => {
    const result = normalizeNoirOutput(rawWith(makeAcirJson()));
    expect(result.gateCount).toBe(0);
  });

  it('uses the bytecode field as acirBase64', () => {
    const bytecode = 'SGVsbG8gV29ybGQ=';
    const result = normalizeNoirOutput(rawWith(makeAcirJson({}, bytecode)));
    expect(result.acirBase64).toBe(bytecode);
  });

  it('parses and returns the ABI from the artifact', () => {
    const abi = {
      parameters: [{ name: 'x', type: { kind: 'field' }, visibility: 'private' }],
      return_type: null,
    };
    const result = normalizeNoirOutput(rawWith(makeAcirJson(abi)));
    expect(result.abi).toEqual(abi);
  });

  it('returns empty warnings array when stdout has no [warning] lines', () => {
    const result = normalizeNoirOutput(rawWith(makeAcirJson(), { stdout: 'compilation complete' }));
    expect(result.warnings).toEqual([]);
  });

  it('extracts [warning] lines from stdout', () => {
    const stdout = '[warning] unused variable `x`\ncompilation succeeded\n[warning] dead code in branch';
    const result = normalizeNoirOutput(rawWith(makeAcirJson(), { stdout }));
    expect(result.warnings).toContain('[warning] unused variable `x`');
    expect(result.warnings).toContain('[warning] dead code in branch');
    expect(result.warnings).toHaveLength(2);
  });

  it('handles an ABI with return_type set', () => {
    const abi = {
      parameters: [{ name: 'x', type: { kind: 'field' }, visibility: 'private' }],
      return_type: { abi_type: { kind: 'field' }, visibility: 'public' },
    };
    const result = normalizeNoirOutput(rawWith(makeAcirJson(abi)));
    expect(result.abi.return_type).not.toBeNull();
  });

  it('throws when acirJson is invalid JSON', () => {
    expect(() => normalizeNoirOutput({ stdout: '', stderr: '', acirJson: 'not-json' })).toThrow();
  });
});
