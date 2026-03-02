import { NextRequest, NextResponse } from 'next/server';
import { generateCalldata } from '@/lib/garagaUtils';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON request body.' },
      { status: 400 }
    );
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { success: false, error: 'Request body must be a JSON object.' },
      { status: 400 }
    );
  }

  const { proofJson, publicInputsJson, vkJson } = body as {
    proofJson?: unknown;
    publicInputsJson?: unknown;
    vkJson?: unknown;
  };

  if (!proofJson || typeof proofJson !== 'object') {
    return NextResponse.json(
      { success: false, error: 'Provide "proofJson" (Groth16 proof object).' },
      { status: 400 }
    );
  }

  if (!publicInputsJson) {
    return NextResponse.json(
      { success: false, error: 'Provide "publicInputsJson" (public inputs array or object).' },
      { status: 400 }
    );
  }

  if (!vkJson || typeof vkJson !== 'object') {
    return NextResponse.json(
      { success: false, error: 'Provide "vkJson" (Groth16 verification key object).' },
      { status: 400 }
    );
  }

  try {
    const calldata = await generateCalldata(proofJson, publicInputsJson, vkJson);

    return NextResponse.json({
      success: true,
      calldata,
    });
  } catch (err) {
    console.error('Groth16 calldata generation failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
