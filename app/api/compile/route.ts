import { NextRequest, NextResponse } from 'next/server';
import { compileCircom } from '@/lib/circom/compileCircom';
import { compileNoir } from '@/lib/noir/compileNoir';
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

  const b = body as Record<string, unknown>;
  const language: LanguageId = (b.language as LanguageId) ?? 'circom';

  // ── Accept multi-file payload: { files: [{filename, content}], entrypoint }
  // OR legacy single-file payload: { source, filename } — converted internally.
  let compileSource: CompileSource;

  if (Array.isArray(b.files)) {
    // Multi-file path
    const files = b.files as { filename: string; content: string }[];
    const entrypoint = (b.entrypoint as string) ?? files[0]?.filename;

    if (!files.length || files.some((f) => f == null || typeof f !== 'object' || typeof f.filename !== 'string' || typeof f.content !== 'string')) {
      return NextResponse.json(
        { success: false, errors: [{ message: 'Each file must have "filename" and "content" string fields.', category: 'validation' }] },
        { status: 400 }
      );
    }

    compileSource = { language, files, entrypoint };
  } else if (typeof b.source === 'string') {
    // Legacy single-file path — wrap in files array
    const filename = (b.filename as string) ?? (language === 'noir' ? 'src/main.nr' : 'circuit.circom');
    compileSource = {
      language,
      files: [{ filename, content: b.source }],
      entrypoint: filename,
    };
  } else {
    return NextResponse.json(
      { success: false, errors: [{ message: 'Request body must include "files" array or "source" string.', category: 'validation' }] },
      { status: 400 }
    );
  }

  // For Noir, auto-set entrypoint to src/main.nr if not specified
  if (language === 'noir' && !compileSource.entrypoint) {
    compileSource = { ...compileSource, entrypoint: 'src/main.nr' };
  }

  const compileResult = language === 'noir'
    ? await compileNoir(compileSource)
    : await compileCircom(compileSource);

  // Buffer objects cannot be directly serialized into Next.js JSON responses.
  // We explicitly convert them to base64 strings if the compilation succeeded.
  if (compileResult.success && compileResult.language === 'circom') {
    const circomRes = compileResult.result as import('@/lib/circom/types').CircomCompileResult;
    
    // Create a new payload omitting the raw buffers, replacing them with base64 strings
    const serializedPayload: any = {
      ...circomRes,
      r1csBase64: circomRes.r1csBuffer?.toString('base64'),
      wasmBase64: circomRes.wasmBuffer?.toString('base64'),
      symContent: circomRes.symContent,
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
