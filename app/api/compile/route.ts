import { NextRequest, NextResponse } from 'next/server';
import { compileCircom } from '@/lib/circom/compileCircom';
import { CompileSource, LanguageId } from '@/lib/circom/types';

// Ensure this route always runs in the Node.js runtime (not Edge).
// Required because CircomServerCompiler uses fs and child processes.
export const runtime = 'nodejs';

/**
 * POST /api/compile
 *
 * Body: { source: string, filename?: string }
 * Response: CompileResponse (CompileSuccessResponse | CompileErrorResponse)
 */
export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        errors: [{ message: 'Invalid JSON body.', category: 'validation' }],
      },
      { status: 400 }
    );
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).source !== 'string'
  ) {
    return NextResponse.json(
      {
        success: false,
        errors: [{ message: 'Request body must include a "source" string field.', category: 'validation' }],
      },
      { status: 400 }
    );
  }

  const { source, filename, language } = body as {
    source: string;
    filename?: string;
    language?: LanguageId;
  };

  const compileSource: CompileSource = {
    language: language ?? 'circom',
    code: source,
    filename: filename ?? (language === 'noir' ? 'circuit.nr' : 'circuit.circom'),
  };

  const compileResult = await compileCircom(compileSource);

  // Buffer objects cannot be directly serialized into Next.js JSON responses.
  // We explicitly convert them to base64 strings if the compilation succeeded.
  if (compileResult.success && compileResult.language === 'circom') {
    const circomRes = compileResult.result as import('@/lib/circom/types').CircomCompileResult;
    
    // Create a new payload omitting the raw buffers, replacing them with base64 strings
    const serializedPayload: any = {
      ...circomRes,
      r1csBase64: circomRes.r1csBuffer?.toString('base64'),
      wasmBase64: circomRes.wasmBuffer?.toString('base64'),
    };
    
    // Explicitly delete the raw buffers so `NextResponse.json` doesn't choke on them
    delete serializedPayload.r1csBuffer;
    delete serializedPayload.wasmBuffer;

    return NextResponse.json({
      success: true,
      language: 'circom',
      result: serializedPayload
    }, { status: 200 });
  }

  return NextResponse.json(compileResult, { status: 200 });
}
