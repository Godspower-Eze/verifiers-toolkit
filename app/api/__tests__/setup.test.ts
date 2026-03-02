import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/setup/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/snarkjs/SnarkjsSetup', () => {
  const mockGenerateZkey = jest.fn();
  return {
    SnarkjsSetup: jest.fn().mockImplementation(() => ({ generateZkey: mockGenerateZkey })),
    __mockGenerateZkey: mockGenerateZkey,
  };
});

const { __mockGenerateZkey } = jest.requireMock('@/lib/snarkjs/SnarkjsSetup');

describe('POST /api/circuit/setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 500 for malformed JSON body (broad try/catch route pattern)', async () => {
    const req = new Request('http://localhost/api/circuit/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    }) as NextRequest;

    const res = await POST(req);
    // This route wraps all errors in a broad try/catch returning 500
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when r1csBase64 is missing', async () => {
    const res = await POST(makeReq({ other: 'field' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when r1csBase64 is not a string', async () => {
    const res = await POST(makeReq({ r1csBase64: 123 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 200 with zkeyBase64 on success', async () => {
    __mockGenerateZkey.mockResolvedValue(Buffer.from('fake-zkey'));

    const res = await POST(makeReq({ r1csBase64: Buffer.from('fake-r1cs').toString('base64') }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.zkeyBase64).toBe('string');
  });

  it('returns 500 when generateZkey throws', async () => {
    __mockGenerateZkey.mockRejectedValue(new Error('WASM OOM'));

    const res = await POST(makeReq({ r1csBase64: Buffer.from('fake').toString('base64') }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('WASM OOM');
  });
});
