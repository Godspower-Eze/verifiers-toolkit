import { NextRequest, NextResponse } from 'next/server';
import { ProofValidator, parseProofJson } from '@/lib/proof/ProofValidator';

export const runtime = 'nodejs';

/**
 * POST /api/proof/validate
 *
 * Body: { proof: object } or { proofJson: string }
 *   - proof: already-parsed Proof object
 *   - proofJson: raw JSON string (from file upload or direct paste)
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

  const { proof, proofJson } = body as { proof?: unknown; proofJson?: string };

  let proofData: unknown;

  if (proofJson !== undefined) {
    if (typeof proofJson !== 'string') {
      return NextResponse.json(
        { valid: false, errors: [{ field: 'proofJson', message: 'proofJson must be a string.' }] },
        { status: 400 }
      );
    }
    const parsed = parseProofJson(proofJson);
    if (!parsed.ok) {
      return NextResponse.json(
        { valid: false, errors: [{ field: 'proofJson', message: parsed.error }] },
        { status: 400 }
      );
    }
    proofData = parsed.data;
  } else if (proof !== undefined) {
    proofData = proof;
  } else {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'body', message: 'Provide either "proof" (object) or "proofJson" (string).' }] },
      { status: 400 }
    );
  }

  const validator = new ProofValidator();
  const result = validator.validate(proofData);

  return NextResponse.json(result, { status: 200 });
}
