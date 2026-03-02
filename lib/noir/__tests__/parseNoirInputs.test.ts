import { parseNoirInputs } from '@/lib/noir/parseNoirInputs';
import { NoirAbi } from '@/lib/circom/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAbi(
  parameters: NoirAbi['parameters'],
  return_type: NoirAbi['return_type'] = null,
): NoirAbi {
  return { parameters, return_type };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parseNoirInputs', () => {
  it('returns empty object for an ABI with no parameters', () => {
    const abi = makeAbi([]);
    expect(parseNoirInputs(abi)).toEqual({});
  });

  it('maps a Field parameter to 0', () => {
    const abi = makeAbi([{ name: 'x', type: { kind: 'field' }, visibility: 'private' }]);
    expect(parseNoirInputs(abi)).toEqual({ x: 0 });
  });

  it('maps an unsigned integer parameter to 0', () => {
    const abi = makeAbi([
      { name: 'n', type: { kind: 'integer', sign: 'unsigned', width: 32 }, visibility: 'private' },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ n: 0 });
  });

  it('maps a signed integer parameter to 0', () => {
    const abi = makeAbi([
      { name: 'i', type: { kind: 'integer', sign: 'signed', width: 64 }, visibility: 'private' },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ i: 0 });
  });

  it('maps a boolean parameter to 0', () => {
    const abi = makeAbi([{ name: 'flag', type: { kind: 'boolean' }, visibility: 'private' }]);
    expect(parseNoirInputs(abi)).toEqual({ flag: 0 });
  });

  it('maps a fixed-length Field array to an array of zeroes', () => {
    const abi = makeAbi([
      { name: 'arr', type: { kind: 'array', length: 3, type: { kind: 'field' } }, visibility: 'private' },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ arr: [0, 0, 0] });
  });

  it('maps a length-1 array to [0]', () => {
    const abi = makeAbi([
      { name: 'single', type: { kind: 'array', length: 1, type: { kind: 'field' } }, visibility: 'private' },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ single: [0] });
  });

  it('maps a length-0 array to []', () => {
    const abi = makeAbi([
      { name: 'empty', type: { kind: 'array', length: 0, type: { kind: 'field' } }, visibility: 'private' },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ empty: [] });
  });

  it('includes private parameters', () => {
    const abi = makeAbi([{ name: 'secret', type: { kind: 'field' }, visibility: 'private' }]);
    expect(parseNoirInputs(abi)).toHaveProperty('secret', 0);
  });

  it('includes public parameters', () => {
    const abi = makeAbi([{ name: 'pub_val', type: { kind: 'field' }, visibility: 'public' }]);
    expect(parseNoirInputs(abi)).toHaveProperty('pub_val', 0);
  });

  it('includes both private and public parameters', () => {
    const abi = makeAbi([
      { name: 'x', type: { kind: 'field' }, visibility: 'private' },
      { name: 'y', type: { kind: 'field' }, visibility: 'public' },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ x: 0, y: 0 });
  });

  it('excludes return type from the result', () => {
    const abi = makeAbi(
      [{ name: 'x', type: { kind: 'field' }, visibility: 'private' }],
      { abi_type: { kind: 'field' }, visibility: 'public' },
    );
    const result = parseNoirInputs(abi);
    expect(result).toEqual({ x: 0 });
    expect(Object.keys(result)).toHaveLength(1);
  });

  it('preserves declaration order of parameters', () => {
    const abi = makeAbi([
      { name: 'b', type: { kind: 'field' }, visibility: 'private' },
      { name: 'a', type: { kind: 'field' }, visibility: 'private' },
      { name: 'c', type: { kind: 'field' }, visibility: 'private' },
    ]);
    const result = parseNoirInputs(abi);
    expect(Object.keys(result)).toEqual(['b', 'a', 'c']);
  });

  it('maps a struct parameter to 0 (flat fallback)', () => {
    const abi = makeAbi([
      {
        name: 'point',
        type: { kind: 'struct', fields: [{ kind: 'field' }, { kind: 'field' }] },
        visibility: 'private',
      },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ point: 0 });
  });

  it('maps a tuple parameter to 0 (flat fallback)', () => {
    const abi = makeAbi([
      {
        name: 'pair',
        type: {
          kind: 'tuple',
          fields: [
            { kind: 'field' },
            { kind: 'integer', sign: 'unsigned', width: 32 },
          ],
        },
        visibility: 'private',
      },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ pair: 0 });
  });

  it('maps a string parameter to 0', () => {
    const abi = makeAbi([
      { name: 'label', type: { kind: 'string', length: 10 }, visibility: 'private' },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ label: 0 });
  });

  it('handles multiple parameters with mixed types', () => {
    const abi = makeAbi([
      { name: 'a', type: { kind: 'field' }, visibility: 'private' },
      { name: 'b', type: { kind: 'integer', sign: 'unsigned', width: 8 }, visibility: 'public' },
      { name: 'c', type: { kind: 'array', length: 2, type: { kind: 'field' } }, visibility: 'private' },
    ]);
    expect(parseNoirInputs(abi)).toEqual({ a: 0, b: 0, c: [0, 0] });
  });
});
