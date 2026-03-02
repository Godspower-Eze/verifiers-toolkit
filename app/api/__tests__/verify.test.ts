import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/verify/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/noir/NoirVerifier', () => {
  const mockVerify = jest.fn();
  return {
    NoirVerifier: jest.fn().mockImplementation(() => ({ verify: mockVerify })),
    __mockVerify: mockVerify,
  };
});

const { __mockVerify } = jest.requireMock('@/lib/noir/NoirVerifier');

describe('POST /api/circuit/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when proofBase64 is missing', async () => {
    const res = await POST(makeReq({ publicInputsBase64: 'abc', vkBase64: 'xyz' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when publicInputsBase64 is missing', async () => {
    const res = await POST(makeReq({ proofBase64: 'abc', vkBase64: 'xyz' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when vkBase64 is missing', async () => {
    const res = await POST(makeReq({ proofBase64: 'abc', publicInputsBase64: 'xyz' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 200 with verified:true on valid proof', async () => {
    __mockVerify.mockResolvedValue({ verified: true, stdout: 'Proof verified', stderr: '' });

    const res = await POST(makeReq({
      proofBase64: Buffer.from('proof').toString('base64'),
      publicInputsBase64: Buffer.from('public').toString('base64'),
      vkBase64: Buffer.from('vk').toString('base64'),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.verified).toBe(true);
  });

  it('returns 200 with verified:false on invalid proof', async () => {
    __mockVerify.mockResolvedValue({ verified: false, stdout: '', stderr: 'Proof invalid' });

    const res = await POST(makeReq({
      proofBase64: Buffer.from('proof').toString('base64'),
      publicInputsBase64: Buffer.from('public').toString('base64'),
      vkBase64: Buffer.from('vk').toString('base64'),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.verified).toBe(false);
  });

  it('returns 500 when verify throws', async () => {
    __mockVerify.mockRejectedValue(new Error('Verifier binary not found'));

    const res = await POST(makeReq({
      proofBase64: Buffer.from('proof').toString('base64'),
      publicInputsBase64: Buffer.from('public').toString('base64'),
      vkBase64: Buffer.from('vk').toString('base64'),
    }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
