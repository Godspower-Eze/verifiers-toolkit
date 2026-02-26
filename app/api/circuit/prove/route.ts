import { NextRequest, NextResponse } from 'next/server';
import { SnarkjsSetup } from '@/lib/snarkjs/SnarkjsSetup';

// Ensure this route always runs in the Node.js runtime (not Edge).
export const runtime = 'nodejs';

/**
 * POST /api/circuit/prove
 *
 * Body expected:
 * {
 *   wasmBase64: string,
 *   zkeyBase64: string,
 *   signals: Record<string, string | number>
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wasmBase64, zkeyBase64, signals } = body;

    if (!wasmBase64 || typeof wasmBase64 !== 'string' || !zkeyBase64 || typeof zkeyBase64 !== 'string') {
      return NextResponse.json({ 
        success: false, 
        error: "Missing required Wasm or ZKey binaries to compute the witness." 
      }, { status: 400 });
    }

    if (!signals || typeof signals !== 'object') {
      return NextResponse.json({ 
        success: false, 
        error: "Missing or invalid 'signals' payload. It must be a JSON object mapping input names to string/number values." 
      }, { status: 400 });
    }

    // Decode Buffers
    const wasmBuffer = Buffer.from(wasmBase64, 'base64');
    const zkeyBuffer = Buffer.from(zkeyBase64, 'base64');

    // Generate Witness + Proof
    const setup = new SnarkjsSetup();
    const result = await setup.generateProof(signals, wasmBuffer, zkeyBuffer);

    return NextResponse.json({
      success: true,
      proofJson: result.proofJson,
      publicInputsJson: result.publicInputsJson
    }, { status: 200 });

  } catch (error: any) {
    console.error('Proving failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || String(error) },
      { status: 500 }
    );
  }
}
