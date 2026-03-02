/**
 * API route unit tests for multi-file compilation scenarios.
 *
 * Tests the POST /api/compile route with multi-file payloads for both
 * Circom and Noir. Uses mocked compilers so no binary toolchain is needed.
 *
 * Covers:
 *   - Request body validation (files array shape, missing fields, bad types)
 *   - Correct forwarding of all files + entrypoint to compileCircom / compileNoir
 *   - Correct serialization of multi-file compilation results
 *   - Error propagation from multi-file compile results
 */
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/compile/route';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/lib/circom/compileCircom', () => ({ compileCircom: jest.fn() }));
jest.mock('@/lib/noir/compileNoir', () => ({ compileNoir: jest.fn() }));

const { compileCircom } = jest.requireMock('@/lib/circom/compileCircom');
const { compileNoir } = jest.requireMock('@/lib/noir/compileNoir');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function circomSuccess() {
  return {
    success: true,
    language: 'circom',
    result: {
      constraintCount: 2,
      wireCount: 5,
      r1csBuffer: Buffer.from('r1cs'),
      wasmBuffer: Buffer.from('wasm'),
      symContent: 'sym',
      warnings: [],
    },
  };
}

function noirSuccess() {
  return {
    success: true,
    language: 'noir',
    result: {
      acirBase64: 'dGVzdA==',
      gateCount: 42,
      acirOpcodeCount: 7,
      abi: { parameters: [{ name: 'x', type: { kind: 'field' }, visibility: 'private' }], return_type: null },
      warnings: [],
    },
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

// ─── Request-body validation ──────────────────────────────────────────────────

describe('POST /api/compile multi-file body validation', () => {
  it('returns 400 when files array contains an element with a non-string filename', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 42, content: 'pragma circom 2.0.0;' }],
      entrypoint: 'main.circom',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files array contains an element with a non-string content', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'main.circom', content: 99 }],
      entrypoint: 'main.circom',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files array contains an element missing filename', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: [{ content: 'pragma circom 2.0.0;' }],
      entrypoint: 'main.circom',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files array contains an element missing content', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'main.circom' }],
      entrypoint: 'main.circom',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files array contains a null element', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: [null],
      entrypoint: 'main.circom',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files array contains a primitive (string)', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: ['main.circom'],
      entrypoint: 'main.circom',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files is not an array but a plain object', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: { filename: 'main.circom', content: 'pragma circom 2.0.0;' },
      entrypoint: 'main.circom',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files is a string', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: 'main.circom',
      entrypoint: 'main.circom',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files array is empty', async () => {
    const res = await POST(makeReq({ language: 'circom', files: [], entrypoint: 'main.circom' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when neither files nor source is present', async () => {
    const res = await POST(makeReq({ language: 'noir', entrypoint: 'src/main.nr' }));
    expect(res.status).toBe(400);
  });
});

// ─── Circom multi-file routing ────────────────────────────────────────────────

describe('POST /api/compile circom multi-file routing', () => {
  it('calls compileCircom with all provided files for a two-file project', async () => {
    compileCircom.mockResolvedValue(circomSuccess());
    await POST(makeReq({
      language: 'circom',
      files: [
        { filename: 'main.circom', content: 'pragma circom 2.0.0;' },
        { filename: 'helper.circom', content: 'pragma circom 2.0.0;' },
      ],
      entrypoint: 'main.circom',
    }));
    expect(compileCircom).toHaveBeenCalledTimes(1);
    const arg = compileCircom.mock.calls[0][0];
    expect(arg.files).toHaveLength(2);
    expect(arg.files.map((f: { filename: string }) => f.filename)).toContain('helper.circom');
  });

  it('passes the entrypoint field unchanged to compileCircom', async () => {
    compileCircom.mockResolvedValue(circomSuccess());
    await POST(makeReq({
      language: 'circom',
      files: [
        { filename: 'main.circom', content: 'pragma circom 2.0.0;' },
        { filename: 'lib/utils.circom', content: 'pragma circom 2.0.0;' },
      ],
      entrypoint: 'main.circom',
    }));
    const arg = compileCircom.mock.calls[0][0];
    expect(arg.entrypoint).toBe('main.circom');
  });

  it('passes language "circom" to compileCircom', async () => {
    compileCircom.mockResolvedValue(circomSuccess());
    await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'main.circom', content: 'pragma circom 2.0.0;' }],
      entrypoint: 'main.circom',
    }));
    const arg = compileCircom.mock.calls[0][0];
    expect(arg.language).toBe('circom');
  });

  it('passes a ten-file circom payload through to compileCircom', async () => {
    compileCircom.mockResolvedValue(circomSuccess());
    const files = Array.from({ length: 10 }, (_, i) => ({
      filename: `file${i}.circom`,
      content: `pragma circom 2.0.0; // file${i}`,
    }));
    await POST(makeReq({ language: 'circom', files, entrypoint: 'file0.circom' }));
    const arg = compileCircom.mock.calls[0][0];
    expect(arg.files).toHaveLength(10);
  });

  it('serializes r1csBuffer to r1csBase64 and wasmBuffer to wasmBase64 in multi-file result', async () => {
    compileCircom.mockResolvedValue(circomSuccess());
    const res = await POST(makeReq({
      language: 'circom',
      files: [
        { filename: 'main.circom', content: 'p' },
        { filename: 'helper.circom', content: 'h' },
      ],
      entrypoint: 'main.circom',
    }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.result.r1csBuffer).toBeUndefined();
    expect(body.result.wasmBuffer).toBeUndefined();
    expect(typeof body.result.r1csBase64).toBe('string');
    expect(typeof body.result.wasmBase64).toBe('string');
  });

  it('propagates multi-file circom compile errors', async () => {
    compileCircom.mockResolvedValue({
      success: false,
      language: 'circom',
      errors: [{ message: 'missing.circom not found', category: 'syntax' }],
    });
    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'main.circom', content: 'pragma circom 2.0.0; include "missing.circom";' }],
      entrypoint: 'main.circom',
    }));
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errors[0].message).toContain('missing.circom');
  });

  it('propagates validation errors from compileCircom (entrypoint not in files)', async () => {
    compileCircom.mockResolvedValue({
      success: false,
      language: 'circom',
      errors: [{ message: 'Entrypoint "other.circom" not found in provided files.', category: 'validation' }],
    });
    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'main.circom', content: 'pragma circom 2.0.0;' }],
      entrypoint: 'other.circom',
    }));
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errors[0].category).toBe('validation');
  });
});

// ─── Noir multi-file routing ──────────────────────────────────────────────────

describe('POST /api/compile noir multi-file routing', () => {
  it('calls compileNoir with all provided files for a two-file project', async () => {
    compileNoir.mockResolvedValue(noirSuccess());
    await POST(makeReq({
      language: 'noir',
      files: [
        { filename: 'src/main.nr', content: 'fn main() {}' },
        { filename: 'src/lib.nr', content: 'pub fn helper() {}' },
      ],
      entrypoint: 'src/main.nr',
    }));
    expect(compileNoir).toHaveBeenCalledTimes(1);
    const arg = compileNoir.mock.calls[0][0];
    expect(arg.files).toHaveLength(2);
    expect(arg.files.map((f: { filename: string }) => f.filename)).toContain('src/lib.nr');
  });

  it('passes the entrypoint field unchanged to compileNoir', async () => {
    compileNoir.mockResolvedValue(noirSuccess());
    await POST(makeReq({
      language: 'noir',
      files: [
        { filename: 'src/main.nr', content: 'fn main() {}' },
        { filename: 'src/lib.nr', content: 'pub fn helper() {}' },
      ],
      entrypoint: 'src/main.nr',
    }));
    const arg = compileNoir.mock.calls[0][0];
    expect(arg.entrypoint).toBe('src/main.nr');
  });

  it('auto-sets noir entrypoint to src/main.nr when not provided', async () => {
    compileNoir.mockResolvedValue(noirSuccess());
    await POST(makeReq({
      language: 'noir',
      files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
      // no entrypoint
    }));
    const arg = compileNoir.mock.calls[0][0];
    expect(arg.entrypoint).toBe('src/main.nr');
  });

  it('passes a ten-file noir payload through to compileNoir', async () => {
    compileNoir.mockResolvedValue(noirSuccess());
    const files = [
      { filename: 'src/main.nr', content: 'fn main() {}' },
      ...Array.from({ length: 9 }, (_, i) => ({
        filename: `src/mod${i}.nr`,
        content: `pub fn func${i}() {}`,
      })),
    ];
    await POST(makeReq({ language: 'noir', files, entrypoint: 'src/main.nr' }));
    const arg = compileNoir.mock.calls[0][0];
    expect(arg.files).toHaveLength(10);
  });

  it('returns 200 with gateCount from multi-file noir result', async () => {
    compileNoir.mockResolvedValue(noirSuccess());
    const res = await POST(makeReq({
      language: 'noir',
      files: [
        { filename: 'src/main.nr', content: 'fn main() {}' },
        { filename: 'src/lib.nr', content: 'pub fn helper() {}' },
      ],
      entrypoint: 'src/main.nr',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.result.gateCount).toBe(42);
  });

  it('propagates multi-file noir compile errors (missing module)', async () => {
    compileNoir.mockResolvedValue({
      success: false,
      language: 'noir',
      errors: [{ message: 'cannot find module `missing`', category: 'syntax', file: 'src/main.nr', line: 1 }],
    });
    const res = await POST(makeReq({
      language: 'noir',
      files: [{ filename: 'src/main.nr', content: 'mod missing; fn main() {}' }],
      entrypoint: 'src/main.nr',
    }));
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errors[0].category).toBe('syntax');
  });

  it('propagates validation errors from compileNoir (missing src/main.nr)', async () => {
    compileNoir.mockResolvedValue({
      success: false,
      language: 'noir',
      errors: [{ message: 'Nargo requires a src/main.nr file', category: 'validation' }],
    });
    const res = await POST(makeReq({
      language: 'noir',
      files: [{ filename: 'src/lib.nr', content: 'pub fn helper() {}' }],
      entrypoint: 'src/lib.nr',
    }));
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errors[0].category).toBe('validation');
  });

  it('propagates validation errors from compileNoir (entrypoint not .nr)', async () => {
    compileNoir.mockResolvedValue({
      success: false,
      language: 'noir',
      errors: [{ message: 'Entrypoint must be a .nr file.', category: 'validation' }],
    });
    const res = await POST(makeReq({
      language: 'noir',
      files: [
        { filename: 'src/main.nr', content: 'fn main() {}' },
        { filename: 'Nargo.toml', content: '[package]' },
      ],
      entrypoint: 'Nargo.toml',
    }));
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errors[0].message).toMatch(/\.nr/i);
  });

  it('does not call compileCircom when language is noir', async () => {
    compileNoir.mockResolvedValue(noirSuccess());
    await POST(makeReq({
      language: 'noir',
      files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
      entrypoint: 'src/main.nr',
    }));
    expect(compileCircom).not.toHaveBeenCalled();
  });

  it('does not call compileNoir when language is circom', async () => {
    compileCircom.mockResolvedValue(circomSuccess());
    await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'main.circom', content: 'pragma circom 2.0.0;' }],
      entrypoint: 'main.circom',
    }));
    expect(compileNoir).not.toHaveBeenCalled();
  });
});

// ─── Duplicate filenames ──────────────────────────────────────────────────────

describe('POST /api/compile duplicate filenames', () => {
  it('passes duplicate filenames through to the compiler without deduplication', async () => {
    // The API route does not deduplicate — that is the compiler's concern
    compileCircom.mockResolvedValue(circomSuccess());
    await POST(makeReq({
      language: 'circom',
      files: [
        { filename: 'main.circom', content: 'pragma circom 2.0.0;' },
        { filename: 'main.circom', content: 'pragma circom 2.0.0; // duplicate' },
      ],
      entrypoint: 'main.circom',
    }));
    const arg = compileCircom.mock.calls[0][0];
    // Both entries are passed through
    expect(arg.files).toHaveLength(2);
  });
});
