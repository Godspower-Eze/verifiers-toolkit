import {
  parseSymInputSignals,
  parseCircomInputSignals,
  CircomInputTemplate,
} from '../parseInputSignals';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a synthetic sym file from an array of signal paths. */
function makeSym(signals: string[]): string {
  return signals.map((s, i) => `${i + 1},1,0,${s}`).join('\n');
}

// ─── parseSymInputSignals ─────────────────────────────────────────────────────

describe('parseSymInputSignals()', () => {

  // ── Basic scalar inputs ───────────────────────────────────────────────────

  it('infers simple scalar inputs', () => {
    const sym = makeSym(['main.a', 'main.b', 'main.c']);
    const src = 'signal input a; signal input b; signal input c;';
    expect(parseSymInputSignals(sym, src)).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('multiplier circuit — two private inputs, one output', () => {
    const sym = makeSym(['main.a', 'main.b', 'main.c']);
    const src = `
      signal input  a;
      signal input  b;
      signal output c;
      c <== a * b;
    `;
    expect(parseSymInputSignals(sym, src)).toEqual({ a: 0, b: 0 });
  });

  // ── Output exclusion ──────────────────────────────────────────────────────

  it('excludes output signals', () => {
    const sym = makeSym(['main.x', 'main.y', 'main.out']);
    const src = 'signal input x; signal input y; signal output out;';
    const result = parseSymInputSignals(sym, src);
    expect(result).toHaveProperty('x');
    expect(result).toHaveProperty('y');
    expect(result).not.toHaveProperty('out');
  });

  // ── Intermediate signal exclusion ─────────────────────────────────────────

  it('excludes intermediate signals that are neither input nor output', () => {
    // dummySquare is a computed intermediate: signal dummySquare <== msg * msg;
    const sym = makeSym(['main.message', 'main.scope', 'main.dummySquare', 'main.result']);
    const src = `
      signal input  message;
      signal input  scope;
      signal output result;
      signal dummySquare <== message * message;
    `;
    const result = parseSymInputSignals(sym, src);
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('scope');
    expect(result).not.toHaveProperty('dummySquare');
    expect(result).not.toHaveProperty('result');
  });

  // ── Sub-component wires excluded ──────────────────────────────────────────

  it('excludes sub-component internal wires', () => {
    const sym = makeSym([
      'main.secret',
      'main.isLessThan.n2b.in[0]',
      'main.isLessThan.n2b.in[1]',
      'main.isLessThan.out',
    ]);
    const src = 'signal input secret;';
    const result = parseSymInputSignals(sym, src);
    expect(result).toEqual({ secret: 0 });
  });

  // ── Literal fixed-size arrays ─────────────────────────────────────────────

  it('groups array elements into a number[] value', () => {
    const sym = makeSym(['main.arr[0]', 'main.arr[1]', 'main.arr[2]']);
    const src = 'signal input arr[3];';
    expect(parseSymInputSignals(sym, src)).toEqual({ arr: [0, 0, 0] });
  });

  it('produces an array not flat keys for array signals', () => {
    const sym = makeSym(['main.siblings[0]', 'main.siblings[1]']);
    const src = 'signal input siblings[2];';
    const result = parseSymInputSignals(sym, src);
    expect(Array.isArray(result.siblings)).toBe(true);
    // Flat keys like "siblings[0]" must NOT appear as object keys
    expect(Object.keys(result)).not.toContain('siblings[0]');
    expect(Object.keys(result)).not.toContain('siblings[1]');
  });

  // ── Template-parameter arrays (core reason sym parsing exists) ────────────

  it('expands template-parameter arrays using compiled sym size', () => {
    // Source declares `arr[MAX_DEPTH]` — regex cannot resolve MAX_DEPTH=5
    // The sym file has the real expanded entries
    const sym = makeSym([
      'main.arr[0]', 'main.arr[1]', 'main.arr[2]', 'main.arr[3]', 'main.arr[4]',
    ]);
    const src = 'template Foo(MAX_DEPTH) { signal input arr[MAX_DEPTH]; }';
    expect(parseSymInputSignals(sym, src)).toEqual({ arr: [0, 0, 0, 0, 0] });
  });

  // ── Comma-separated declarations ──────────────────────────────────────────

  it('handles comma-separated scalar declarations', () => {
    const sym = makeSym(['main.a', 'main.b', 'main.c']);
    const src = 'signal input a, b, c;';
    expect(parseSymInputSignals(sym, src)).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('handles mixed comma-separated scalars and arrays', () => {
    const sym = makeSym([
      'main.length', 'main.index', 'main.siblings[0]', 'main.siblings[1]',
    ]);
    const src = 'signal input length, index, siblings[N];';
    expect(parseSymInputSignals(sym, src)).toEqual({
      length: 0,
      index: 0,
      siblings: [0, 0],
    });
  });

  // ── Mixed scalars and arrays ──────────────────────────────────────────────

  it('handles mixed scalar and array inputs in the same circuit', () => {
    const sym = makeSym([
      'main.secret', 'main.count', 'main.siblings[0]', 'main.siblings[1]', 'main.out',
    ]);
    const src = `
      signal input  secret;
      signal input  count;
      signal input  siblings[2];
      signal output out;
    `;
    expect(parseSymInputSignals(sym, src)).toEqual({
      secret: 0,
      count: 0,
      siblings: [0, 0],
    });
  });

  // ── Array index ordering ──────────────────────────────────────────────────

  it('preserves array indices in the correct numeric order', () => {
    // sym files may not always list in index order for large circuits
    const sym = makeSym([
      'main.arr[2]', 'main.arr[0]', 'main.arr[1]',
    ]);
    const src = 'signal input arr[3];';
    const result = parseSymInputSignals(sym, src) as { arr: number[] };
    expect(result.arr[0]).toBe(0);
    expect(result.arr[1]).toBe(0);
    expect(result.arr[2]).toBe(0);
    expect(result.arr.length).toBe(3);
  });

  // ── Semaphore v4 realistic test ───────────────────────────────────────────

  it('correctly infers all Semaphore(10) inputs', () => {
    const sym = makeSym([
      'main.message',
      'main.scope',
      'main.secret',
      'main.merkleProofLength',
      'main.merkleProofIndex',
      ...Array.from({ length: 10 }, (_, i) => `main.merkleProofSiblings[${i}]`),
      // outputs — must be excluded
      'main.merkleRoot',
      'main.nullifier',
      // intermediate — must be excluded
      'main.dummySquare',
      // sub-component internals — must be excluded
      'main.isLessThan.n2b.in[0]',
      'main.isLessThan.out',
      'main.poseidon.inputs[0]',
    ]);

    const src = `
      pragma circom 2.1.5;
      template Semaphore(MAX_DEPTH) {
        signal input secret;
        signal input merkleProofLength, merkleProofIndex, merkleProofSiblings[MAX_DEPTH];
        signal input message;
        signal input scope;
        signal output merkleRoot, nullifier;
        signal dummySquare <== message * message;
      }
      component main { public [message, scope] } = Semaphore(10);
    `;

    const result = parseSymInputSignals(sym, src);

    // All six input signals present
    expect(result).toHaveProperty('message', 0);
    expect(result).toHaveProperty('scope', 0);
    expect(result).toHaveProperty('secret', 0);
    expect(result).toHaveProperty('merkleProofLength', 0);
    expect(result).toHaveProperty('merkleProofIndex', 0);
    expect(result).toHaveProperty('merkleProofSiblings');
    expect(Array.isArray(result.merkleProofSiblings)).toBe(true);
    expect(result.merkleProofSiblings).toHaveLength(10);

    // Outputs, intermediates, sub-component wires absent
    expect(result).not.toHaveProperty('merkleRoot');
    expect(result).not.toHaveProperty('nullifier');
    expect(result).not.toHaveProperty('dummySquare');

    // No flat array keys
    expect(Object.keys(result)).not.toContain('merkleProofSiblings[0]');
    expect(Object.keys(result)).not.toContain('merkleProofSiblings[9]');

    // Exactly 6 keys total
    expect(Object.keys(result)).toHaveLength(6);
  });

  it('Semaphore result is valid JSON for snarkjs (no undefined values)', () => {
    const sym = makeSym([
      'main.secret', 'main.merkleProofSiblings[0]', 'main.merkleProofSiblings[1]',
      'main.message', 'main.scope', 'main.merkleRoot',
    ]);
    const src = `
      signal input secret;
      signal input merkleProofSiblings[N];
      signal input message;
      signal input scope;
      signal output merkleRoot;
    `;
    const result = parseSymInputSignals(sym, src);
    // Must round-trip through JSON without loss
    const json = JSON.parse(JSON.stringify(result));
    expect(json).toEqual(result);
  });

  // ── Adder circuit ─────────────────────────────────────────────────────────

  it('adder circuit — two private inputs, one output, one intermediate', () => {
    const sym = makeSym(['main.a', 'main.b', 'main.out', 'main.dummy']);
    const src = `
      signal input  a;
      signal input  b;
      signal output out;
      signal dummy;
      dummy <== a * b;
      out <== a + b;
    `;
    expect(parseSymInputSignals(sym, src)).toEqual({ a: 0, b: 0 });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('returns empty object when sym has no main signals', () => {
    const sym = makeSym(['1', 'one', 'signal_without_main']);
    const src = 'signal input a;';
    // None of the sym lines start with "main." so nothing matches
    expect(parseSymInputSignals(sym, src)).toEqual({});
  });

  it('returns empty object when source has no signal input declarations', () => {
    const sym = makeSym(['main.a', 'main.b']);
    const src = 'signal output out; out <== 1;';
    expect(parseSymInputSignals(sym, src)).toEqual({});
  });

  it('handles empty sym content gracefully', () => {
    expect(parseSymInputSignals('', 'signal input a;')).toEqual({});
  });

  it('handles empty source gracefully', () => {
    const sym = makeSym(['main.a']);
    expect(parseSymInputSignals(sym, '')).toEqual({});
  });

  it('handles malformed sym lines (no comma) gracefully', () => {
    const sym = 'MALFORMED LINE\nmain.a\n1,1,0,main.a';
    const src = 'signal input a;';
    expect(parseSymInputSignals(sym, src)).toEqual({ a: 0 });
  });

  it('does not include the same signal twice', () => {
    // Some tools may emit duplicate entries for the same signal path
    const sym = '1,1,0,main.a\n2,1,0,main.a\n3,1,0,main.b';
    const src = 'signal input a; signal input b;';
    const result = parseSymInputSignals(sym, src);
    expect(Object.keys(result).filter((k) => k === 'a')).toHaveLength(1);
  });

  it('multi-output circuit — only inputs returned', () => {
    const sym = makeSym(['main.in', 'main.out1', 'main.out2']);
    const src = 'signal input in; signal output out1, out2;';
    expect(parseSymInputSignals(sym, src)).toEqual({ in: 0 });
  });

  it('large array produces correctly-sized output', () => {
    const size = 20;
    const sym = makeSym(Array.from({ length: size }, (_, i) => `main.path[${i}]`));
    const src = `signal input path[MAX];`;
    const result = parseSymInputSignals(sym, src) as { path: number[] };
    expect(result.path).toHaveLength(size);
    expect(result.path.every((v) => v === 0)).toBe(true);
  });
});

// ─── parseCircomInputSignals (fallback) ───────────────────────────────────────

describe('parseCircomInputSignals()', () => {

  it('infers scalar inputs', () => {
    expect(parseCircomInputSignals('signal input a; signal input b;'))
      .toEqual({ a: 0, b: 0 });
  });

  it('infers fixed-size array as number[]', () => {
    const result = parseCircomInputSignals('signal input arr[3];');
    expect(result).toEqual({ arr: [0, 0, 0] });
    expect(Array.isArray(result.arr)).toBe(true);
  });

  it('does not include output signals', () => {
    // regex only grabs "signal input", so outputs are never included
    const result = parseCircomInputSignals('signal input a; signal output b;');
    expect(result).toHaveProperty('a');
    expect(result).not.toHaveProperty('b');
  });

  it('skips variable-size arrays (limitation)', () => {
    // This is the known limitation the sym approach fixes
    const result = parseCircomInputSignals('signal input arr[N];');
    expect(result).not.toHaveProperty('arr');
  });

  it('handles empty source', () => {
    expect(parseCircomInputSignals('')).toEqual({});
  });

  it('multiplier circuit', () => {
    const src = `
      signal input  a;
      signal input  b;
      signal output c;
      c <== a * b;
    `;
    expect(parseCircomInputSignals(src)).toEqual({ a: 0, b: 0 });
  });
});
