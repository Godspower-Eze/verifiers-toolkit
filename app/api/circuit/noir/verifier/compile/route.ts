import { NextResponse } from 'next/server';
import { ScarbCompiler } from '@/lib/verifier/ScarbCompiler';

const compiler = new ScarbCompiler();

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid payload' },
        { status: 400 }
      );
    }

    const { projectName, verifierCairo, constantsCairo, circuitsCairo, libCairo, scarbToml } = body as {
      projectName?: string;
      verifierCairo?: string;
      constantsCairo?: string;
      circuitsCairo?: string;
      libCairo?: string;
      scarbToml?: string;
    };

    if (!projectName || !verifierCairo || !constantsCairo || !libCairo || !scarbToml) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required Cairo/Scarb files in payload',
        },
        { status: 400 }
      );
    }

    const result = await compiler.compile({
      projectName,
      verifierCairo,
      constantsCairo,
      circuitsCairo,
      libCairo,
      scarbToml,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('API Error in /api/circuit/noir/verifier/compile:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
