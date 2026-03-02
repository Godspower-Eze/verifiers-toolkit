import { GET } from '@/app/api/templates/route';

jest.mock('@/lib/circom/circomTemplates', () => ({
  getCircomTemplates: () => [
    {
      id: 'circom-multiplier',
      name: 'Multiplier',
      language: 'circom',
      files: [{ filename: 'circuit.circom', content: 'pragma circom 2.0.0;' }],
      entrypoint: 'circuit.circom',
    },
  ],
}));

jest.mock('@/lib/noir/noirTemplates', () => ({
  getNoirTemplates: () => [
    {
      id: 'noir-basic',
      name: 'Basic',
      language: 'noir',
      files: [{ filename: 'src/main.nr', content: 'fn main() {}' }],
      entrypoint: 'src/main.nr',
    },
  ],
}));

describe('GET /api/templates', () => {
  it('returns 200 with a combined array of circom + noir templates', async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it('all templates have required fields: id, name, language, files, entrypoint', async () => {
    const res = await GET();
    const body = await res.json();

    for (const t of body) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('language');
      expect(t).toHaveProperty('files');
      expect(t).toHaveProperty('entrypoint');
    }
  });

  it('includes both circom and noir templates', async () => {
    const res = await GET();
    const body = await res.json();
    const langs = body.map((t: any) => t.language);
    expect(langs).toContain('circom');
    expect(langs).toContain('noir');
  });
});
