import { NextRequest, NextResponse } from 'next/server';
import { SnarkjsSetup } from '@/lib/snarkjs/SnarkjsSetup';
import { NoirProver } from '@/lib/noir/NoirProver';
import { CompileSource, SourceFile } from '@/lib/circom/types';

// Ensure this route always runs in the Node.js runtime (not Edge).
export const runtime = 'nodejs';

/**
 * POST /api/circuit/prove
 *
 * Circom body:
 * {
 *   wasmBase64: string,
 *   zkeyBase64: string,
 *   signals: Record<string, string | number>
 * }
 *
 * Noir body:
 * {
 *   language: 'noir',
 *   files: Array<{ filename: string; content: string }>,
 *   entrypoint: string,
 *   inputs: Record<string, string | string[]>
 * }
 *
 * Why source files instead of compiled ACIR:
 *   nargo execute always recompiles from source on every invocation.
 *   Sending source files allows nargo to compile AND generate the witness
 *   in one step, which is required for correct proof generation.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { language } = body;

    // ── Noir path ─────────────────────────────────────────────────────────
    if (language === 'noir') {
      const { files, entrypoint, inputs } = body;

      if (!Array.isArray(files) || files.length === 0) {
        return NextResponse.json(
          { success: false, error: "Missing or invalid 'files'. Must be a non-empty array of { filename, content } objects." },
          { status: 400 },
        );
      }

      if (!entrypoint || typeof entrypoint !== 'string') {
        return NextResponse.json(
          { success: false, error: "Missing or invalid 'entrypoint'." },
          { status: 400 },
        );
      }

      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
        return NextResponse.json(
          { success: false, error: "Missing or invalid 'inputs'. Must be a key-value object." },
          { status: 400 },
        );
      }

      const source: CompileSource = {
        language: 'noir',
        files: files as SourceFile[],
        entrypoint,
      };

      const prover = new NoirProver();
      const raw = await prover.prove(source, inputs as Record<string, unknown>);

      if (!raw.proofBuffer || !raw.publicInputsBuffer || !raw.vkBuffer) {
        return NextResponse.json(
          { success: false, error: raw.stderr || 'Proof generation failed.' },
          { status: 200 },
        );
      }

      return NextResponse.json(
        {
          success: true,
          proofBase64: raw.proofBuffer.toString('base64'),
          publicInputsBase64: raw.publicInputsBuffer.toString('base64'),
          vkBase64: raw.vkBuffer.toString('base64'),
        },
        { status: 200 },
      );
    }

    // ── Circom path ───────────────────────────────────────────────────────
    const { wasmBase64, zkeyBase64, signals } = body;

    if (!wasmBase64 || typeof wasmBase64 !== 'string' || !zkeyBase64 || typeof zkeyBase64 !== 'string') {
      return NextResponse.json({
        success: false,
        error: 'Missing required Wasm or ZKey binaries to compute the witness.',
      }, { status: 400 });
    }

    if (!signals || typeof signals !== 'object') {
      return NextResponse.json({
        success: false,
        error: "Missing or invalid 'signals' payload. It must be a JSON object mapping input names to string/number values.",
      }, { status: 400 });
    }

    const wasmBuffer = Buffer.from(wasmBase64, 'base64');
    const zkeyBuffer = Buffer.from(zkeyBase64, 'base64');

    const setup = new SnarkjsSetup();
    const result = await setup.generateProof(signals, wasmBuffer, zkeyBuffer);

    return NextResponse.json({
      success: true,
      proofJson: result.proofJson,
      publicInputsJson: result.publicInputsJson,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Proving failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || String(error) },
      { status: 500 },
    );
  }
}
