import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/noir/validate-vk/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/noir/validate-vk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('garaga', () => ({
  init: jest.fn().mockResolvedValue(undefined),
}));

describe('POST /api/circuit/noir/validate-vk', () => {
  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/circuit/noir/validate-vk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/circuit/noir/validate-vk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"string"',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when vkBase64 is missing', async () => {
    const res = await POST(makeReq({ other: 'field' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors[0].field).toBe('body');
  });

  it('returns 400 when vkBase64 is not a string', async () => {
    const res = await POST(makeReq({ vkBase64: 123 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 400 when buffer is empty', async () => {
    // Empty base64 decodes to empty buffer
    const res = await POST(makeReq({ vkBase64: '' }));
    // Missing vkBase64 (empty string is falsy-ish but the route checks === undefined)
    expect(res.status).toBe(400);
  });

  it('returns valid:false for buffer that is too small (< 32 bytes)', async () => {
    const smallBuf = Buffer.from('tiny');
    const res = await POST(makeReq({ vkBase64: smallBuf.toString('base64') }));
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 200 valid:true for a buffer >= 32 bytes', async () => {
    // Buffer >= 32 bytes and < 1000 bytes → ultra_keccak_honk
    const buf = Buffer.alloc(100, 0xab);
    const res = await POST(makeReq({ vkBase64: buf.toString('base64') }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary.system).toBe('ultra_keccak_honk');
    expect(body.summary.curve).toBe('BN254');
  });

  it('returns ultra_keccak_zk_honk for buffer > 1000 bytes', async () => {
    const buf = Buffer.alloc(1500, 0xcd);
    const res = await POST(makeReq({ vkBase64: buf.toString('base64') }));
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary.system).toBe('ultra_keccak_zk_honk');
  });
});
