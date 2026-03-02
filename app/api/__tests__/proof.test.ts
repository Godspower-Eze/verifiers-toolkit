import { NextRequest } from 'next/server';
import { POST } from '@/app/api/proof/validate/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/proof/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/proof/ProofValidator', () => {
  const mockValidate = jest.fn();
  return {
    ProofValidator: jest.fn().mockImplementation(() => ({ validate: mockValidate })),
    parseProofJson: jest.fn((s: string) => {
      try {
        return { ok: true, data: JSON.parse(s) };
      } catch {
        return { ok: false, error: 'Invalid JSON' };
      }
    }),
    __mockValidate: mockValidate,
  };
});

const { __mockValidate } = jest.requireMock('@/lib/proof/ProofValidator');

describe('POST /api/proof/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/proof/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/proof/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '42',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when neither proof nor proofJson provided', async () => {
    const res = await POST(makeReq({ other: 'field' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 200 valid:true for valid Groth16 proof object', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      summary: { system: 'groth16', curve: 'BN254' },
    });

    const res = await POST(makeReq({ proof: { pi_a: ['0x1', '0x2', '1'] } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary.system).toBe('groth16');
  });

  it('returns 200 valid:true for UltraHonk proof object with proofBase64', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      summary: { system: 'ultra_honk' },
    });

    const res = await POST(makeReq({ proof: { proofBase64: 'AAAA' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary.system).toBe('ultra_honk');
  });

  it('returns 200 valid:true for SP1 proof', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      summary: { system: 'sp1' },
    });

    const res = await POST(makeReq({ proof: { proof: '0x', public_values: '0x', vkey: '0x' } }));
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary.system).toBe('sp1');
  });

  it('returns 200 valid:false for invalid proof', async () => {
    __mockValidate.mockReturnValue({
      valid: false,
      errors: [{ field: 'proof', message: 'Unrecognized proof format' }],
    });

    const res = await POST(makeReq({ proof: { random: 'data' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('accepts proofJson string', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      summary: { system: 'groth16' },
    });

    const res = await POST(makeReq({ proofJson: JSON.stringify({ pi_a: ['0x1'] }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });
});
