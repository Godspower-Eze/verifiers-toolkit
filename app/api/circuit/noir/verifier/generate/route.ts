import { NextRequest, NextResponse } from 'next/server';
import { NoirVerifierGenerator } from '@/lib/verifier/VerifierGenerator';

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

  const { vkBase64, projectName } = body as { vkBase64?: unknown; projectName?: unknown };

  if (!vkBase64 || typeof vkBase64 !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Provide "vkBase64" (base64-encoded binary VK from bb write_vk).' },
      { status: 400 }
    );
  }

  const name = typeof projectName === 'string' && projectName.trim() 
    ? projectName.trim() 
    : 'honk_verifier';

  try {
    const generator = new NoirVerifierGenerator();
    const result = await generator.generate(vkBase64, name);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      verifier: {
        projectName: result.verifier!.projectName,
        honkVerifierCairo: result.verifier!.honkVerifierCairo,
        honkVerifierCircuitsCairo: result.verifier!.honkVerifierCircuitsCairo,
        honkVerifierConstantsCairo: result.verifier!.honkVerifierConstantsCairo,
        libCairo: result.verifier!.libCairo,
        scarbToml: result.verifier!.scarbToml,
      },
    });
  } catch (err) {
    console.error('Noir verifier generation failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
