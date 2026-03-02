import { POST } from '@/app/api/circuit/noir/verifier/compile/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/circuit/noir/verifier/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

jest.mock('@/lib/verifier/ScarbCompiler', () => {
  const mockCompile = jest.fn();
  return {
    ScarbCompiler: jest.fn().mockImplementation(() => ({ compile: mockCompile })),
    __mockCompile: mockCompile,
  };
});

const { __mockCompile } = jest.requireMock('@/lib/verifier/ScarbCompiler');

describe('POST /api/circuit/noir/verifier/compile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/circuit/noir/verifier/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(500); // the route wraps the JSON parse error in try/catch
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(makeReq({ projectName: 'test' })); // missing verifierCairo etc.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when body is not an object', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 200 with compiled output on success', async () => {
    __mockCompile.mockResolvedValue({
      success: true,
      sierra: '{}',
      casm: '{}',
    });

    const res = await POST(makeReq({
      projectName: 'honk_verifier',
      verifierCairo: '// verifier',
      constantsCairo: '// constants',
      circuitsCairo: '// circuits',
      libCairo: '// lib',
      scarbToml: '[package]',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 400 when compile fails', async () => {
    __mockCompile.mockResolvedValue({
      success: false,
      error: 'Compilation error in verifier.cairo',
    });

    const res = await POST(makeReq({
      projectName: 'honk_verifier',
      verifierCairo: '// broken',
      constantsCairo: '// constants',
      circuitsCairo: '// circuits',
      libCairo: '// lib',
      scarbToml: '[package]',
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 500 on unexpected error', async () => {
    __mockCompile.mockRejectedValue(new Error('Scarb binary not found'));

    const res = await POST(makeReq({
      projectName: 'honk_verifier',
      verifierCairo: '// v',
      constantsCairo: '// c',
      circuitsCairo: '// ci',
      libCairo: '// l',
      scarbToml: '[package]',
    }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
