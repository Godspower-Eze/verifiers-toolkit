import { NextRequest, NextResponse } from 'next/server';
import { NoirVerifier } from '@/lib/noir/NoirVerifier';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { proofBase64, publicInputsBase64, vkBase64 } = body;

    if (!proofBase64 || typeof proofBase64 !== 'string') {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'proofBase64'." },
        { status: 400 },
      );
    }

    if (!publicInputsBase64 || typeof publicInputsBase64 !== 'string') {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'publicInputsBase64'." },
        { status: 400 },
      );
    }

    if (!vkBase64 || typeof vkBase64 !== 'string') {
      return NextResponse.json(
        { success: false, error: "Missing or invalid 'vkBase64'." },
        { status: 400 },
      );
    }

    const proofBuffer = Buffer.from(proofBase64, 'base64');
    const publicInputsBuffer = Buffer.from(publicInputsBase64, 'base64');
    const vkBuffer = Buffer.from(vkBase64, 'base64');

    const verifier = new NoirVerifier();
    const result = await verifier.verify(proofBuffer, publicInputsBuffer, vkBuffer);

    return NextResponse.json(
      {
        success: true,
        verified: result.verified,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error('Noir verification failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
