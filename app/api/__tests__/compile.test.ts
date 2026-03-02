import { NextRequest } from 'next/server';
import { POST } from '@/app/api/compile/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/circom/compileCircom', () => ({
  compileCircom: jest.fn(),
}));

jest.mock('@/lib/noir/compileNoir', () => ({
  compileNoir: jest.fn(),
}));

const { compileCircom } = jest.requireMock('@/lib/circom/compileCircom');
const { compileNoir } = jest.requireMock('@/lib/noir/compileNoir');

describe('POST /api/compile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad-json',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when neither files nor source is provided', async () => {
    const res = await POST(makeReq({ language: 'circom' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when files array is empty', async () => {
    const res = await POST(makeReq({ language: 'circom', files: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when files contain invalid entries', async () => {
    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 123, content: 'pragma circom 2.0.0;' }],
    }));
    expect(res.status).toBe(400);
  });

  it('calls compileCircom for circom language with valid multi-file payload', async () => {
    compileCircom.mockResolvedValue({
      success: true,
      language: 'circom',
      result: {
        constraintCount: 1,
        wireCount: 2,
        r1csBuffer: Buffer.from('test'),
        wasmBuffer: Buffer.from('test'),
        symContent: '',
        warnings: [],
      },
    });

    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'circuit.circom', content: 'pragma circom 2.0.0; template T() {} component main = T();' }],
      entrypoint: 'circuit.circom',
    }));

    expect(compileCircom).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.result.r1csBase64).toBeDefined();
    expect(body.result.wasmBase64).toBeDefined();
  });

  it('serializes circom result: omits raw buffers and includes base64 strings', async () => {
    compileCircom.mockResolvedValue({
      success: true,
      language: 'circom',
      result: {
        constraintCount: 5,
        r1csBuffer: Buffer.from('r1cs-data'),
        wasmBuffer: Buffer.from('wasm-data'),
        symContent: 'sym',
        warnings: [],
      },
    });

    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'circuit.circom', content: 'test' }],
      entrypoint: 'circuit.circom',
    }));

    const body = await res.json();
    expect(body.result.r1csBuffer).toBeUndefined();
    expect(body.result.wasmBuffer).toBeUndefined();
    expect(typeof body.result.r1csBase64).toBe('string');
    expect(typeof body.result.wasmBase64).toBe('string');
  });

  it('calls compileNoir for noir language', async () => {
    compileNoir.mockResolvedValue({
      success: true,
      language: 'noir',
      result: { gateCount: 10, acirOpcodeCount: 5 },
    });

    const res = await POST(makeReq({
      language: 'noir',
      files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
      entrypoint: 'src/main.nr',
    }));

    expect(compileNoir).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.result.gateCount).toBe(10);
  });

  it('defaults to circom when language is not specified', async () => {
    compileCircom.mockResolvedValue({
      success: true,
      language: 'circom',
      result: { constraintCount: 1, r1csBuffer: Buffer.from('x'), wasmBuffer: Buffer.from('x'), symContent: '', warnings: [] },
    });

    await POST(makeReq({
      files: [{ filename: 'circuit.circom', content: 'test' }],
      entrypoint: 'circuit.circom',
    }));

    expect(compileCircom).toHaveBeenCalled();
  });

  it('accepts legacy single-file source payload', async () => {
    compileCircom.mockResolvedValue({
      success: true,
      language: 'circom',
      result: { constraintCount: 1, r1csBuffer: Buffer.from('x'), wasmBuffer: Buffer.from('x'), symContent: '', warnings: [] },
    });

    const res = await POST(makeReq({
      language: 'circom',
      source: 'pragma circom 2.0.0;',
      filename: 'circuit.circom',
    }));

    expect(compileCircom).toHaveBeenCalled();
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('propagates compile errors', async () => {
    compileCircom.mockResolvedValue({
      success: false,
      errors: [{ message: 'Syntax error', category: 'syntax', line: 1 }],
    });

    const res = await POST(makeReq({
      language: 'circom',
      files: [{ filename: 'circuit.circom', content: 'bad code' }],
      entrypoint: 'circuit.circom',
    }));

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errors).toBeDefined();
  });
});
