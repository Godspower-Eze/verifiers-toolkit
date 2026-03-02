import { NextRequest } from 'next/server';
import { POST } from '@/app/api/circuit/prove/route';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/circuit/prove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

jest.mock('@/lib/snarkjs/SnarkjsSetup', () => {
  const mockGenerateProof = jest.fn();
  return {
    SnarkjsSetup: jest.fn().mockImplementation(() => ({ generateProof: mockGenerateProof })),
    __mockGenerateProof: mockGenerateProof,
  };
});

jest.mock('@/lib/noir/NoirProver', () => {
  const mockProve = jest.fn();
  return {
    NoirProver: jest.fn().mockImplementation(() => ({ prove: mockProve })),
    __mockProve: mockProve,
  };
});

const { __mockGenerateProof } = jest.requireMock('@/lib/snarkjs/SnarkjsSetup');
const { __mockProve } = jest.requireMock('@/lib/noir/NoirProver');

describe('POST /api/circuit/prove', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Circom path', () => {
    it('returns 400 when wasmBase64 is missing', async () => {
      const res = await POST(makeReq({ zkeyBase64: 'abc', signals: { a: 1 } }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns 400 when zkeyBase64 is missing', async () => {
      const res = await POST(makeReq({ wasmBase64: 'abc', signals: { a: 1 } }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns 400 when signals is missing', async () => {
      const res = await POST(makeReq({ wasmBase64: 'abc', zkeyBase64: 'xyz' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns 200 with proofJson and publicInputsJson on success', async () => {
      __mockGenerateProof.mockResolvedValue({
        proofJson: '{"pi_a":[]}',
        publicInputsJson: '["0x1"]',
      });

      const res = await POST(makeReq({
        wasmBase64: Buffer.from('wasm').toString('base64'),
        zkeyBase64: Buffer.from('zkey').toString('base64'),
        signals: { a: 3, b: 11 },
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.proofJson).toBeDefined();
      expect(body.publicInputsJson).toBeDefined();
    });

    it('returns 500 when generateProof throws', async () => {
      __mockGenerateProof.mockRejectedValue(new Error('Invalid witness'));

      const res = await POST(makeReq({
        wasmBase64: Buffer.from('wasm').toString('base64'),
        zkeyBase64: Buffer.from('zkey').toString('base64'),
        signals: { a: 3 },
      }));

      expect(res.status).toBe(500);
    });
  });

  describe('Noir path', () => {
    it('returns 400 when files is missing', async () => {
      const res = await POST(makeReq({ language: 'noir', entrypoint: 'src/main.nr', inputs: {} }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when entrypoint is missing', async () => {
      const res = await POST(makeReq({
        language: 'noir',
        files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
        inputs: {},
      }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when inputs is missing', async () => {
      const res = await POST(makeReq({
        language: 'noir',
        files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
        entrypoint: 'src/main.nr',
      }));
      expect(res.status).toBe(400);
    });

    it('returns 200 with base64 proof/public/vk on success', async () => {
      __mockProve.mockResolvedValue({
        proofBuffer: Buffer.from('proof'),
        publicInputsBuffer: Buffer.from('public'),
        vkBuffer: Buffer.from('vk'),
        stderr: '',
      });

      const res = await POST(makeReq({
        language: 'noir',
        files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
        entrypoint: 'src/main.nr',
        inputs: { x: '5' },
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(typeof body.proofBase64).toBe('string');
      expect(typeof body.publicInputsBase64).toBe('string');
      expect(typeof body.vkBase64).toBe('string');
    });

    it('returns 200 with success:false when prover returns no buffers', async () => {
      __mockProve.mockResolvedValue({
        proofBuffer: null,
        publicInputsBuffer: null,
        vkBuffer: null,
        stderr: 'Prover failed',
      });

      const res = await POST(makeReq({
        language: 'noir',
        files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
        entrypoint: 'src/main.nr',
        inputs: { x: '5' },
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Prover failed');
    });
  });
});
