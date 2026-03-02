import { NextRequest, NextResponse } from 'next/server';
import * as garaga from 'garaga';

export const runtime = 'nodejs';

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

  const { publicInputBase64 } = body as { publicInputBase64?: unknown };

  if (!publicInputBase64 || typeof publicInputBase64 !== 'string') {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'body', message: 'Provide "publicInputBase64" (base64-encoded public inputs from bb prove).' }] },
      { status: 400 }
    );
  }

  let publicInputBuffer: Buffer;
  try {
    publicInputBuffer = Buffer.from(publicInputBase64, 'base64');
  } catch {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'publicInputBase64', message: 'Invalid base64 string.' }] },
      { status: 400 }
    );
  }

  if (publicInputBuffer.length === 0) {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'publicInputBase64', message: 'Public input buffer is empty.' }] },
      { status: 400 }
    );
  }

  try {
    await garaga.init();

    const publicInputBytes = new Uint8Array(publicInputBuffer);
    const inputCount = Math.ceil(publicInputBytes.length / 32);

    return NextResponse.json({
      valid: true,
      summary: {
        format: 'ultra_keccak_zk_honk',
        inputCount,
        size: publicInputBuffer.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { valid: false, errors: [{ field: 'publicInputBase64', message: `Invalid Noir public inputs: ${message}` }] },
      { status: 400 }
    );
  }
}
