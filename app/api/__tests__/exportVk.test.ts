import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/export-vk/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/export-vk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/snarkjs/SnarkjsSetup', () => {
  const mockExportVk = jest.fn();
  return {
    SnarkjsSetup: jest.fn().mockImplementation(() => ({ exportVerificationKey: mockExportVk })),
    __mockExportVk: mockExportVk,
  };
});

const { __mockExportVk } = jest.requireMock('@/lib/snarkjs/SnarkjsSetup');

describe('POST /api/circuit/export-vk', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 500 for malformed JSON body (broad try/catch route pattern)', async () => {
    const req = new Request('http://localhost/api/circuit/export-vk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }) as NextRequest;

    const res = await POST(req);
    // This route wraps all errors in a broad try/catch returning 500
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when zkeyBase64 is missing', async () => {
    const res = await POST(makeReq({ other: 'field' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when zkeyBase64 is not a string', async () => {
    const res = await POST(makeReq({ zkeyBase64: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 200 with vkJson on success', async () => {
    const fakeVkJson = JSON.stringify({ protocol: 'groth16', curve: 'bn128' });
    __mockExportVk.mockResolvedValue(fakeVkJson);

    const res = await POST(makeReq({ zkeyBase64: Buffer.from('fake-zkey').toString('base64') }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.vkJson).toBe(fakeVkJson);
  });

  it('returns 500 when exportVerificationKey throws', async () => {
    __mockExportVk.mockRejectedValue(new Error('Export error'));

    const res = await POST(makeReq({ zkeyBase64: Buffer.from('fake').toString('base64') }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Export error');
  });
});
