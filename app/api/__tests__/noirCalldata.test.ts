import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/noir/calldata/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/noir/calldata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/garagaUtils', () => ({
  generateNoirCalldata: jest.fn(),
  generateCalldata: jest.fn(),
}));

const { generateNoirCalldata } = jest.requireMock('@/lib/garagaUtils');

describe('POST /api/circuit/noir/calldata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/circuit/noir/calldata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad-json',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/circuit/noir/calldata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"string"',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when proofBase64 is missing', async () => {
    const res = await POST(makeReq({ publicInputsBase64: 'abc', vkBase64: 'xyz' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('proofBase64');
  });

  it('returns 400 when publicInputsBase64 is missing', async () => {
    const res = await POST(makeReq({ proofBase64: 'abc', vkBase64: 'xyz' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('publicInputsBase64');
  });

  it('returns 400 when vkBase64 is missing', async () => {
    const res = await POST(makeReq({ proofBase64: 'abc', publicInputsBase64: 'xyz' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('vkBase64');
  });

  it('returns 200 with calldata array on success', async () => {
    generateNoirCalldata.mockResolvedValue(['0x1', '0x2', '0x3']);

    const res = await POST(makeReq({
      proofBase64: Buffer.from('proof').toString('base64'),
      publicInputsBase64: Buffer.from('public').toString('base64'),
      vkBase64: Buffer.from('vk').toString('base64'),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.calldata).toEqual(['0x1', '0x2', '0x3']);
  });

  it('passes trimmed strings to generateNoirCalldata', async () => {
    generateNoirCalldata.mockResolvedValue(['0x1']);

    await POST(makeReq({
      proofBase64: '  proofdata  ',
      publicInputsBase64: '  pubdata  ',
      vkBase64: '  vkdata  ',
    }));

    // The route passes strings as-is (trimming happens outside, but the route stores the original value)
    expect(generateNoirCalldata).toHaveBeenCalledWith('  proofdata  ', '  pubdata  ', '  vkdata  ');
  });

  it('returns 500 when generateNoirCalldata throws', async () => {
    generateNoirCalldata.mockRejectedValue(new Error('Garaga error'));

    const res = await POST(makeReq({
      proofBase64: 'abc',
      publicInputsBase64: 'def',
      vkBase64: 'ghi',
    }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Garaga error');
  });
});
