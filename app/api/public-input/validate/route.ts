import { NextRequest, NextResponse } from 'next/server';
import { PublicInputValidator, parsePublicInputJson } from '@/lib/publicInput/PublicInputValidator';

export const runtime = 'nodejs';

/**
 * POST /api/public-input/validate
 *
 * Body: { publicInput: unknown } or { publicInputJson: string }
 *   - publicInput: already-parsed Public Input JSON
 *   - publicInputJson: raw JSON string (from file upload or direct paste)
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

  const { publicInput, publicInputJson } = body as { publicInput?: unknown; publicInputJson?: string };

  let inputData: unknown;

  if (publicInputJson !== undefined) {
    if (typeof publicInputJson !== 'string') {
      return NextResponse.json(
        { valid: false, errors: [{ field: 'publicInputJson', message: 'publicInputJson must be a string.' }] },
        { status: 400 }
      );
    }
    const parsed = parsePublicInputJson(publicInputJson);
    if (!parsed.ok) {
      return NextResponse.json(
        { valid: false, errors: [{ field: 'publicInputJson', message: parsed.error }] },
        { status: 400 }
      );
    }
    inputData = parsed.data;
  } else if (publicInput !== undefined) {
    inputData = publicInput;
  } else {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'body', message: 'Provide either "publicInput" (object/array) or "publicInputJson" (string).' }] },
      { status: 400 }
    );
  }

  const validator = new PublicInputValidator();
  const result = validator.validate(inputData);

  return NextResponse.json(result, { status: 200 });
}
