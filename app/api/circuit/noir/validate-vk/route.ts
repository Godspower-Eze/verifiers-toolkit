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

  const { vkBase64 } = body as { vkBase64?: unknown };

  if (vkBase64 === undefined) {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'body', message: 'Provide "vkBase64" (base64-encoded binary VK from bb write_vk).' }] },
      { status: 400 }
    );
  }

  if (typeof vkBase64 !== 'string') {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'vkBase64', message: 'vkBase64 must be a string.' }] },
      { status: 400 }
    );
  }

  let vkBuffer: Buffer;
  try {
    vkBuffer = Buffer.from(vkBase64, 'base64');
  } catch {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'vkBase64', message: 'Invalid base64 string.' }] },
      { status: 400 }
    );
  }

  if (vkBuffer.length === 0) {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'vkBase64', message: 'VK buffer is empty.' }] },
      { status: 400 }
    );
  }

  if (vkBuffer.length < 32) {
    return NextResponse.json(
      { valid: false, errors: [{ field: 'vkBase64', message: 'VK buffer too small to be valid.' }] },
      { status: 400 }
    );
  }

  try {
    await garaga.init();

    const vk = new Uint8Array(vkBuffer);

    const MIN_VK_SIZE = 1000;
    const isLikelyZK = vkBuffer.length > MIN_VK_SIZE;
    const systemName = isLikelyZK ? 'ultra_keccak_zk_honk' : 'ultra_keccak_honk';

    return NextResponse.json({
      valid: true,
      vk: {
        size: vkBuffer.length,
        system: systemName,
      },
      summary: {
        system: systemName,
        curve: 'BN254',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { valid: false, errors: [{ field: 'vkBase64', message: `Invalid Noir verification key: ${message}` }] },
      { status: 400 }
    );
  }
}
