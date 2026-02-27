import { NextRequest, NextResponse } from 'next/server';
import { VkValidator } from '@/lib/vk/VkValidator';
import { VerifierGenerator } from '@/lib/verifier/VerifierGenerator';

export const runtime = 'nodejs';

/**
 * POST /api/verifier/generate
 *
 * Body: { vk: SnarkJsVk }
 *   A validated SnarkJS Groth16 BN254 VK object (from POST /api/vk/validate).
 *
 * Response (success):
 *   200 { success: true, verifier: GeneratedVerifier }
 *
 * Response (failure):
 *   200 { success: false, error: string }
 *   400 { success: false, error: string }  — bad request body
 */
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

  const { vk, projectName } = body as { vk?: unknown; projectName?: string };

  if (!vk) {
    return NextResponse.json(
      { success: false, error: 'Missing "vk" field in request body.' },
      { status: 400 }
    );
  }

  // Re-validate the VK before generation (defence in depth)
  const validator = new VkValidator();
  const validation = validator.validate(vk);

  if (!validation.valid) {
    return NextResponse.json(
      { success: false, error: 'Invalid VK: ' + validation.errors.map((e) => e.message).join('; ') },
      { status: 400 }
    );
  }

  const generator = new VerifierGenerator();
  const result = await generator.generate(validation.vk, 'groth16', projectName);

  return NextResponse.json(result, { status: 200 });
}
