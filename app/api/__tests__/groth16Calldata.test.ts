import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/groth16/calldata/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/groth16/calldata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/garagaUtils', () => ({
  generateCalldata: jest.fn(),
  generateNoirCalldata: jest.fn(),
}));

const { generateCalldata } = jest.requireMock('@/lib/garagaUtils');

describe('POST /api/circuit/groth16/calldata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/circuit/groth16/calldata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/circuit/groth16/calldata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '42',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when proofJson is missing', async () => {
    const res = await POST(makeReq({ publicInputsJson: [], vkJson: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('proofJson');
  });

  it('returns 400 when publicInputsJson is missing', async () => {
    const res = await POST(makeReq({ proofJson: { pi_a: [] }, vkJson: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('publicInputsJson');
  });

  it('returns 400 when vkJson is missing', async () => {
    const res = await POST(makeReq({ proofJson: { pi_a: [] }, publicInputsJson: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('vkJson');
  });

  it('returns 400 when proofJson is not an object', async () => {
    const res = await POST(makeReq({ proofJson: 'string-proof', publicInputsJson: [], vkJson: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 200 with calldata array on success', async () => {
    generateCalldata.mockResolvedValue(['0x10', '0x20', '0x30']);

    const res = await POST(makeReq({
      proofJson: { pi_a: ['0x1'], pi_b: [['0x2']], pi_c: ['0x3'] },
      publicInputsJson: ['0x1'],
      vkJson: { protocol: 'groth16', curve: 'bn128' },
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.calldata).toEqual(['0x10', '0x20', '0x30']);
  });

  it('calls generateCalldata with the parsed JSON objects', async () => {
    generateCalldata.mockResolvedValue(['0x1']);

    const proofJson = { pi_a: ['0x1'] };
    const publicInputsJson = ['0x2'];
    const vkJson = { protocol: 'groth16' };

    await POST(makeReq({ proofJson, publicInputsJson, vkJson }));

    expect(generateCalldata).toHaveBeenCalledWith(proofJson, publicInputsJson, vkJson);
  });

  it('returns 500 when generateCalldata throws', async () => {
    generateCalldata.mockRejectedValue(new Error('Invalid VK format'));

    const res = await POST(makeReq({
      proofJson: { pi_a: [] },
      publicInputsJson: [],
      vkJson: { bad: 'vk' },
    }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid VK format');
  });
});
