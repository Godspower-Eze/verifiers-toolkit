import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/noir/validate-public-input/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/noir/validate-public-input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('garaga', () => ({
  init: jest.fn().mockResolvedValue(undefined),
}));

describe('POST /api/circuit/noir/validate-public-input', () => {
  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/circuit/noir/validate-public-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not an object', async () => {
    const req = new Request('http://localhost/api/circuit/noir/validate-public-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '42',
    }) as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when publicInputBase64 is missing', async () => {
    const res = await POST(makeReq({ other: 'field' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns 400 when publicInputBase64 is not a string', async () => {
    const res = await POST(makeReq({ publicInputBase64: 42 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it('returns valid:false when publicInputBase64 is empty string (treated as missing)', async () => {
    // Buffer.alloc(0).toString('base64') === '' (empty string), which is falsy,
    // so the route treats it as missing and returns field 'body'
    const res = await POST(makeReq({ publicInputBase64: '' }));
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors[0].field).toBe('body');
  });

  it('returns 200 valid:true for non-empty buffer', async () => {
    const buf = Buffer.alloc(64, 0x01); // 2 × 32-byte inputs
    const res = await POST(makeReq({ publicInputBase64: buf.toString('base64') }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary.inputCount).toBe(2);
    expect(body.summary.size).toBe(64);
  });

  it('calculates inputCount correctly for 96-byte buffer (3 inputs)', async () => {
    const buf = Buffer.alloc(96, 0x02);
    const res = await POST(makeReq({ publicInputBase64: buf.toString('base64') }));
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.summary.inputCount).toBe(3);
  });
});
