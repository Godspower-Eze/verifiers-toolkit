import { getCircuitTemplates, CircuitTemplate } from '@/lib/circom/circuitTemplates';
import { compileCircom } from '@/lib/circom/compileCircom';

jest.setTimeout(60_000); // real compilation for template validation

// ─── Unit tests: template list shape ─────────────────────────────────────────

describe('getCircuitTemplates()', () => {
  let templates: CircuitTemplate[];

  beforeEach(() => {
    templates = getCircuitTemplates();
  });

  it('returns at least 3 templates', () => {
    expect(templates.length).toBeGreaterThanOrEqual(3);
  });

  it('every template has a unique id', () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template has a non-empty name', () => {
    templates.forEach((t) => expect(t.name.trim()).not.toBe(''));
  });

  it('every template has a non-empty description', () => {
    templates.forEach((t) => expect(t.description.trim()).not.toBe(''));
  });

  it('every template has at least one non-empty file', () => {
    templates.forEach((t) => {
      expect(t.files.length).toBeGreaterThan(0);
      t.files.forEach((f) => expect(f.content.trim()).not.toBe(''));
    });
  });

  it('every template has a non-empty entrypoint', () => {
    templates.forEach((t) => expect(t.entrypoint.trim()).not.toBe(''));
  });

  it('every template has a valid language id', () => {
    templates.forEach((t) => expect(['circom', 'noir']).toContain(t.language));
  });

  it('includes a multiplier template', () => {
    expect(templates.find((t) => t.id === 'multiplier')).toBeDefined();
  });

  it('includes an adder template', () => {
    expect(templates.find((t) => t.id === 'adder')).toBeDefined();
  });

  it('includes a custom template', () => {
    expect(templates.find((t) => t.id === 'custom')).toBeDefined();
  });

  it('all circom templates have an entrypoint ending in .circom', () => {
    templates
      .filter((t) => t.language === 'circom')
      .forEach((t) => expect(t.entrypoint).toMatch(/\.circom$/));
  });
});

// ─── Integration tests: all templates compile ─────────────────────────────────

describe('circuit templates compile successfully', () => {
  const templates = getCircuitTemplates().filter((t) => t.language === 'circom');

  for (const template of templates) {
    it(`template "${template.name}" compiles without errors`, async () => {
      const response = await compileCircom({
        language: 'circom',
        files: template.files,
        entrypoint: template.entrypoint,
      });

      if (!response.success) {
        // Print errors to make debugging easy if a template breaks
        console.error(`Template "${template.name}" failed:`, response.errors);
      }

      expect(response.success).toBe(true);
    });
  }
});
