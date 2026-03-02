import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/noir/verifier/generate/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/noir/verifier/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/verifier/VerifierGenerator', () => {
  const mockGenerate = jest.fn();
  return {
    NoirVerifierGenerator: jest.fn().mockImplementation(() => ({ generate: mockGenerate })),
    VerifierGenerator: jest.fn().mockImplementation(() => ({ generate: jest.fn() })),
    __mockGenerate: mockGenerate,
  };
});

const { __mockGenerate } = jest.requireMock('@/lib/verifier/VerifierGenerator');

describe('POST /api/circuit/noir/verifier/generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/circuit/noir/verifier/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/circuit/noir/verifier/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when vkBase64 is missing', async () => {
    const res = await POST(makeReq({ projectName: 'my_verifier' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when vkBase64 is not a string', async () => {
    const res = await POST(makeReq({ vkBase64: 123, projectName: 'my_verifier' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('uses default projectName "honk_verifier" when not provided', async () => {
    __mockGenerate.mockResolvedValue({ success: true, verifier: { files: [] } });

    await POST(makeReq({ vkBase64: Buffer.from('vk').toString('base64') }));

    expect(__mockGenerate).toHaveBeenCalledWith(
      Buffer.from('vk').toString('base64'),
      'honk_verifier'
    );
  });

  it('uses provided projectName', async () => {
    __mockGenerate.mockResolvedValue({ success: true, verifier: { files: [] } });

    await POST(makeReq({ vkBase64: Buffer.from('vk').toString('base64'), projectName: 'my_proj' }));

    expect(__mockGenerate).toHaveBeenCalledWith(
      Buffer.from('vk').toString('base64'),
      'my_proj'
    );
  });

  it('returns 200 with verifier on success', async () => {
    __mockGenerate.mockResolvedValue({
      success: true,
      verifier: { mainCairo: '// cairo code', scarbToml: '[package]' },
    });

    const res = await POST(makeReq({
      vkBase64: Buffer.from('vk').toString('base64'),
      projectName: 'test',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.verifier).toBeDefined();
  });

  it('returns 500 when generator returns success:false', async () => {
    __mockGenerate.mockResolvedValue({ success: false, error: 'bb not found' });

    const res = await POST(makeReq({
      vkBase64: Buffer.from('vk').toString('base64'),
    }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('bb not found');
  });

  it('returns 500 when generate throws', async () => {
    __mockGenerate.mockRejectedValue(new Error('Unexpected error'));

    const res = await POST(makeReq({ vkBase64: 'abc' }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Unexpected error');
  });
});
