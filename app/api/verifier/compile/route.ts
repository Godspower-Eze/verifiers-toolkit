import { NextResponse } from 'next/server';
import { ScarbCompiler, ScarbCompileInput } from '@/lib/verifier/ScarbCompiler';

const compiler = new ScarbCompiler();

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();

    // Basic validation
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid payload' },
        { status: 400 }
      );
    }

    const { projectName, verifierCairo, constantsCairo, libCairo, scarbToml } = body as Partial<ScarbCompileInput>;

    if (!projectName || !verifierCairo || !constantsCairo || !libCairo || !scarbToml) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required Cairo/Scarb files in payload',
        },
        { status: 400 }
      );
    }

    // Compile using Scarb
    const result = await compiler.compile({
      projectName,
      verifierCairo,
      constantsCairo,
      libCairo,
      scarbToml,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    // Return the Sierra and Casm JSON objects
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('API Error in /api/verifier/compile:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
