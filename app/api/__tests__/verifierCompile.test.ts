import { POST } from '@/app/api/verifier/compile/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/verifier/compile', {
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

describe('POST /api/verifier/compile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when body is not an object', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when required Cairo fields are missing', async () => {
    const res = await POST(makeReq({ projectName: 'test' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Missing required');
  });

  it('returns 200 with compiled Sierra/Casm on success', async () => {
    __mockCompile.mockResolvedValue({
      success: true,
      sierra: { sierra_program: [] },
      casm: { bytecode: [] },
    });

    const res = await POST(makeReq({
      projectName: 'groth16_verifier',
      verifierCairo: '// verifier',
      constantsCairo: '// constants',
      libCairo: '// lib',
      scarbToml: '[package]',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sierra).toBeDefined();
    expect(body.casm).toBeDefined();
  });

  it('returns 400 when compile fails', async () => {
    __mockCompile.mockResolvedValue({
      success: false,
      error: 'Compilation error in verifier.cairo',
    });

    const res = await POST(makeReq({
      projectName: 'groth16_verifier',
      verifierCairo: '// broken',
      constantsCairo: '// constants',
      libCairo: '// lib',
      scarbToml: '[package]',
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 500 on unexpected error', async () => {
    __mockCompile.mockRejectedValue(new Error('Scarb not installed'));

    const res = await POST(makeReq({
      projectName: 'test',
      verifierCairo: '// v',
      constantsCairo: '// c',
      libCairo: '// l',
      scarbToml: '[package]',
    }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('passes all Cairo file contents to the compiler', async () => {
    __mockCompile.mockResolvedValue({ success: true, sierra: {}, casm: {} });

    await POST(makeReq({
      projectName: 'test_proj',
      verifierCairo: '// verifier content',
      constantsCairo: '// constants content',
      libCairo: '// lib content',
      scarbToml: '[package]\nname = "test_proj"',
    }));

    expect(__mockCompile).toHaveBeenCalledWith({
      projectName: 'test_proj',
      verifierCairo: '// verifier content',
      constantsCairo: '// constants content',
      libCairo: '// lib content',
      scarbToml: '[package]\nname = "test_proj"',
    });
  });
});
