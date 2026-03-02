import { NextResponse } from 'next/server';
import { getCircomTemplates } from '@/lib/circom/circomTemplates';
import { getNoirTemplates } from '@/lib/noir/noirTemplates';

export const runtime = 'nodejs';

/**
 * GET /api/templates
 *
 * Returns all built-in circuit templates (Circom + Noir) as a flat JSON array.
 * Clients use this to populate the template picker without bundling
 * template code into the client-side JavaScript bundle.
 */
export async function GET() {
  const templates = [...getCircomTemplates(), ...getNoirTemplates()];
  return NextResponse.json(templates, { status: 200 });
}
