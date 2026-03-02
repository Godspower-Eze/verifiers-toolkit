import { NextRequest } from 'next/server';
import { POST } from '@/app/api/verifier/generate/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/verifier/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/vk/VkValidator', () => {
  const mockValidate = jest.fn();
  return {
    VkValidator: jest.fn().mockImplementation(() => ({ validate: mockValidate })),
    parseVkJson: jest.fn((s: string) => {
      try { return { ok: true, data: JSON.parse(s) }; }
      catch { return { ok: false, error: 'Invalid JSON' }; }
    }),
    __mockValidate: mockValidate,
  };
});

jest.mock('@/lib/verifier/VerifierGenerator', () => {
  const mockGenerate = jest.fn();
  return {
    VerifierGenerator: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
    NoirVerifierGenerator: jest.fn().mockImplementation(() => ({ generate: jest.fn() })),
    __mockGenerate: mockGenerate,
  };
});

const { __mockValidate } = jest.requireMock('@/lib/vk/VkValidator');
const { __mockGenerate } = jest.requireMock('@/lib/verifier/VerifierGenerator');

describe('POST /api/verifier/generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/verifier/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/verifier/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"string"',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when vk is missing', async () => {
    const res = await POST(makeReq({ projectName: 'test' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('vk');
  });

  it('returns 400 when vk fails re-validation', async () => {
    __mockValidate.mockReturnValue({
      valid: false,
      errors: [{ field: 'protocol', message: 'Missing protocol' }],
    });

    const res = await POST(makeReq({ vk: { badKey: 'value' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 200 with verifier on success', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      vk: { protocol: 'groth16', curve: 'BN254' },
      summary: { curve: 'BN254', protocol: 'groth16', icLength: 2 },
    });
    __mockGenerate.mockResolvedValue({
      success: true,
      verifier: {
        mainCairo: '// cairo code',
        constantsCairo: '// constants',
        libCairo: '// lib',
        scarbToml: '[package]',
      },
    });

    const res = await POST(makeReq({
      vk: { protocol: 'groth16', curve: 'bn128' },
      projectName: 'my_verifier',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.verifier).toBeDefined();
  });

  it('passes projectName to generator', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      vk: { protocol: 'groth16' },
      summary: { curve: 'BN254', protocol: 'groth16', icLength: 1 },
    });
    __mockGenerate.mockResolvedValue({ success: true, verifier: {} });

    await POST(makeReq({ vk: { protocol: 'groth16' }, projectName: 'custom_name' }));

    expect(__mockGenerate).toHaveBeenCalledWith(
      expect.anything(),
      'groth16',
      'custom_name'
    );
  });
});
