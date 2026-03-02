import { NextRequest } from 'next/server';
import { POST } from '@/app/api/public-input/validate/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/public-input/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/publicInput/PublicInputValidator', () => {
  const mockValidate = jest.fn();
  return {
    PublicInputValidator: jest.fn().mockImplementation(() => ({ validate: mockValidate })),
    parsePublicInputJson: jest.fn((s: string) => {
      try {
        return { ok: true, data: JSON.parse(s) };
      } catch {
        return { ok: false, error: 'Invalid JSON' };
      }
    }),
    __mockValidate: mockValidate,
  };
});

const { __mockValidate } = jest.requireMock('@/lib/publicInput/PublicInputValidator');

describe('POST /api/public-input/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/public-input/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad-json',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/public-input/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when neither publicInput nor publicInputJson is provided', async () => {
    const res = await POST(makeReq({ other: 'field' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 200 valid:true for flat array of public inputs', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      summary: { format: 'flat_array', count: 2 },
    });

    const res = await POST(makeReq({ publicInput: ['0x123', '0x456'] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary.format).toBe('flat_array');
  });

  it('returns 200 valid:true for gnark object mapping', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      summary: { format: 'gnark_object', count: 1 },
    });

    const res = await POST(makeReq({ publicInput: { input_1: '123' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });

  it('returns 200 valid:false for invalid public inputs', async () => {
    __mockValidate.mockReturnValue({
      valid: false,
      errors: [{ field: 'publicInput', message: 'Unrecognized format' }],
    });

    const res = await POST(makeReq({ publicInput: 42 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('accepts publicInputJson string', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      summary: { format: 'flat_array', count: 1 },
    });

    const res = await POST(makeReq({ publicInputJson: '["0x1"]' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });
});
