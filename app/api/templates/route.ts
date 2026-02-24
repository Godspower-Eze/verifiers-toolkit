import { NextResponse } from 'next/server';
import { getCircuitTemplates } from '@/lib/circom/circuitTemplates';

export const runtime = 'nodejs';

/**
 * GET /api/templates
 *
 * Returns the list of built-in circuit templates as JSON.
 * Clients use this to populate the template picker without bundling
 * template code into the client-side JavaScript bundle.
 */
export async function GET() {
  const templates = getCircuitTemplates();
  return NextResponse.json(templates, { status: 200 });
}
