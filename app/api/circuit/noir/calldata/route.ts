import { NextRequest, NextResponse } from 'next/server';
import { generateNoirCalldata } from '@/lib/garagaUtils';

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

  const { proofBase64, publicInputsBase64, vkBase64 } = body as {
    proofBase64?: unknown;
    publicInputsBase64?: unknown;
    vkBase64?: unknown;
  };

  if (!proofBase64 || typeof proofBase64 !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Provide "proofBase64" (base64-encoded proof from bb prove).' },
      { status: 400 }
    );
  }

  if (!publicInputsBase64 || typeof publicInputsBase64 !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Provide "publicInputsBase64" (base64-encoded public inputs from bb prove).' },
      { status: 400 }
    );
  }

  if (!vkBase64 || typeof vkBase64 !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Provide "vkBase64" (base64-encoded VK from bb write_vk).' },
      { status: 400 }
    );
  }

  try {
    const calldata = await generateNoirCalldata(proofBase64, publicInputsBase64, vkBase64);

    return NextResponse.json({
      success: true,
      calldata,
    });
  } catch (err) {
    console.error('Noir calldata generation failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
