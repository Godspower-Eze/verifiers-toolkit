import { NextRequest } from 'next/server';
import { POST } from '@/app/api/vk/validate/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/vk/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

// Mock VkValidator to avoid garaga dependency in unit tests
jest.mock('@/lib/vk/VkValidator', () => {
  const mockValidate = jest.fn();
  return {
    VkValidator: jest.fn().mockImplementation(() => ({ validate: mockValidate })),
    parseVkJson: jest.fn((s: string) => {
      try {
        return { ok: true, data: JSON.parse(s) };
      } catch {
        return { ok: false, error: 'Invalid JSON' };
      }
    }),
    __mockValidate: mockValidate,
  };
});

const { __mockValidate } = jest.requireMock('@/lib/vk/VkValidator');

describe('POST /api/vk/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/vk/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/vk/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"just-a-string"',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 400 when neither vk nor vkJson is provided', async () => {
    const res = await POST(makeReq({ someOtherField: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors[0].field).toBe('body');
  });

  it('returns 400 when vkJson is not a string', async () => {
    const res = await POST(makeReq({ vkJson: 123 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 400 when vkJson is invalid JSON', async () => {
    const res = await POST(makeReq({ vkJson: '{bad json' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 200 with valid:true when vk object passes validation', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      vk: { protocol: 'groth16' },
      summary: { curve: 'BN254', protocol: 'groth16', icLength: 2 },
    });

    const res = await POST(makeReq({ vk: { protocol: 'groth16', curve: 'bn128' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary).toBeDefined();
  });

  it('returns 200 with valid:false when vk fails validation', async () => {
    __mockValidate.mockReturnValue({
      valid: false,
      errors: [{ field: 'protocol', message: 'Missing protocol' }],
    });

    const res = await POST(makeReq({ vk: { randomField: 'value' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('accepts vkJson string and validates its parsed contents', async () => {
    __mockValidate.mockReturnValue({
      valid: true,
      vk: { protocol: 'groth16' },
      summary: { curve: 'BN254', protocol: 'groth16', icLength: 2 },
    });

    const res = await POST(makeReq({ vkJson: JSON.stringify({ protocol: 'groth16', curve: 'bn128' }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
  });
});
