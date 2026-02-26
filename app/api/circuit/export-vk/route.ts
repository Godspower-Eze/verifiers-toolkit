import { NextRequest, NextResponse } from 'next/server';
import { SnarkjsSetup } from '@/lib/snarkjs/SnarkjsSetup';

// Ensure this route always runs in the Node.js runtime (not Edge).
// snarkjs uses native crypto and fs operations heavily.
export const runtime = 'nodejs';

/**
 * POST /api/circuit/export-vk
 *
 * Body expected:
 * {
 *   zkeyBase64: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { zkeyBase64 } = body;

    if (!zkeyBase64 || typeof zkeyBase64 !== 'string') {
      return NextResponse.json({ 
        success: false, 
        error: "Missing or invalid 'zkeyBase64' payload. Ensure you generated a ZKey first." 
      }, { status: 400 });
    }

    // Decode ZKey Buffer
    const zkeyBuffer = Buffer.from(zkeyBase64, 'base64');

    // Run Export
    const setup = new SnarkjsSetup();
    const vkJsonRaw = await setup.exportVerificationKey(zkeyBuffer);

    return NextResponse.json({
      success: true,
      vkJson: vkJsonRaw
    }, { status: 200 });

  } catch (error: any) {
    console.error('Export VK failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || String(error) },
      { status: 500 }
    );
  }
}
