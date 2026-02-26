import { NextRequest, NextResponse } from 'next/server';
import { SnarkjsSetup } from '@/lib/snarkjs/SnarkjsSetup';

// Ensure this route always runs in the Node.js runtime (not Edge).
// snarkjs uses native crypto and fs operations heavily.
export const runtime = 'nodejs';

/**
 * POST /api/circuit/setup
 *
 * Body expected:
 * {
 *   r1csBase64: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { r1csBase64 } = body;

    if (!r1csBase64 || typeof r1csBase64 !== 'string') {
      return NextResponse.json({ 
        success: false, 
        error: "Missing or invalid 'r1csBase64' payload. Ensure you compiled the circuit first." 
      }, { status: 400 });
    }

    // Decode R1CS Buffer
    const r1csBuffer = Buffer.from(r1csBase64, 'base64');

    // Run Setup
    const setup = new SnarkjsSetup();
    const zkeyBuffer = await setup.generateZkey(r1csBuffer);

    // Encode ZKey Buffer for client network
    const zkeyBase64 = zkeyBuffer.toString('base64');

    return NextResponse.json({
      success: true,
      zkeyBase64: zkeyBase64
    }, { status: 200 });

  } catch (error: any) {
    console.error('Setup failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || String(error) },
      { status: 500 }
    );
  }
}
