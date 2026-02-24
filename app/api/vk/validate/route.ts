import { NextRequest, NextResponse } from 'next/server';
import { VkValidator, parseVkJson } from '@/lib/vk/VkValidator';

export const runtime = 'nodejs';

/**
 * POST /api/vk/validate
 *
 * Body: { vk: object } or { vkJson: string }
 *   - vk: already-parsed VK object (from JSON paste parsed client-side)
 *   - vkJson: raw JSON string (from file upload or direct paste)
 *
 * Response:
 *   200 { valid: true, vk: SnarkJsVk }
 *   200 { valid: false, errors: VkFieldError[] }
 *   400 { valid: false, errors: [{ field: 'body', message: '...' }] }
 */
export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'body', message: 'Invalid JSON request body.' }] },
      { status: 400 }
    );
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'body', message: 'Request body must be a JSON object.' }] },
      { status: 400 }
    );
  }

  const { vk, vkJson } = body as { vk?: unknown; vkJson?: string };

  let vkData: unknown;

  if (vkJson !== undefined) {
    // Caller sent a raw JSON string (file upload path)
    if (typeof vkJson !== 'string') {
      return NextResponse.json(
        { valid: false, errors: [{ field: 'vkJson', message: 'vkJson must be a string.' }] },
        { status: 400 }
      );
    }
    const parsed = parseVkJson(vkJson);
    if (!parsed.ok) {
      return NextResponse.json(
        { valid: false, errors: [{ field: 'vkJson', message: parsed.error }] },
        { status: 400 }
      );
    }
    vkData = parsed.data;
  } else if (vk !== undefined) {
    // Caller sent a pre-parsed object
    vkData = vk;
  } else {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'body', message: 'Provide either "vk" (object) or "vkJson" (string).' }] },
      { status: 400 }
    );
  }

  const validator = new VkValidator();
  const result = validator.validate(vkData);

  return NextResponse.json(result, { status: 200 });
}
