import { VkValidator, parseVkJson } from '@/lib/vk/VkValidator';

import * as fs from 'fs';
import * as path from 'path';

// ─── VkValidator.validate ─────────────────────────────────────────────────────

describe('VkValidator.validate', () => {
  const validator = new VkValidator();

  describe('valid Garaga formats', () => {
    const vksDir = path.join(process.cwd(), 'tmp_vks');
    // NOTE: This test strictly relies on `tmp_vks` being populated with Garaga test fixtures.
    // If they aren't downloaded, we gracefully skip to not break CI unexpectedly without context.
    
    if (fs.existsSync(vksDir)) {
      const files = [
        'gnark_vk_bn254.json',
        'snarkjs_vk_bls12381.json',
        'snarkjs_vk_bn254.json',
        'vk_bls.json',
        'vk_bn254.json',
        'vk_risc0.json',
        'vk_sp1.json'
      ];

      for (const file of files) {
        if (fs.existsSync(path.join(vksDir, file))) {
          it(`validates ${file} successfully directly via garaga object parsing`, () => {
            const vkJson = JSON.parse(fs.readFileSync(path.join(vksDir, file), 'utf8'));
            const result = validator.validate(vkJson);
            expect(result.valid).toBe(true);
            
            if (result.valid) {
               expect(['BN254', 'BLS12_381']).toContain(result.summary.curve);
               expect(result.summary.icLength).toBeGreaterThan(0);
            }
          });
        }
      }
    } else {
       it.skip('Skipped testing 7 Garaga formats because tmp_vks/ is not present.', () => {});
    }
  });

  // ── Type errors ──────────────────────────────────────────────────────────────

  describe('invalid root type', () => {
    it('rejects null', () => {
      expect(validator.validate(null).valid).toBe(false);
    });

    it('rejects a string', () => {
      expect(validator.validate('{"protocol":"groth16"}').valid).toBe(false);
    });

    it('rejects an array', () => {
      expect(validator.validate([]).valid).toBe(false);
    });

    it('rejects a number', () => {
      expect(validator.validate(42).valid).toBe(false);
    });
  });

  // ── Missing required fields ───────────────────────────────────────────────────

  describe('invalid shapes', () => {
    it('rejects structurally invalid keys (missing IC or points) that Garaga cannot parse', () => {
      const result = validator.validate({ protocol: 'groth16', randomRubbish: true });
      expect(result.valid).toBe(false);
      
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].message).toContain('Invalid Verification Key');
      }
    });

    it('rejects malformed math structures (e.g. string arrays instead of coordinate strings)', () => {
      const badVk = {
         curve: 'bn254',
         protocol: 'groth16',
         vk_alpha_1: ['a', 'b', 'c'] // not valid math string
      };
      const result = validator.validate(badVk);
      expect(result.valid).toBe(false);
    });
  });
});

// ─── parseVkJson ──────────────────────────────────────────────────────────────

describe('parseVkJson', () => {
  it('returns ok:true for valid JSON', () => {
    const result = parseVkJson('{"protocol":"groth16"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).protocol).toBe('groth16');
    }
  });

  it('returns ok:false for malformed JSON', () => {
    const result = parseVkJson('{not valid json}');
    expect(result.ok).toBe(false);
  });

  it('error message mentions the parse problem', () => {
    const result = parseVkJson('{bad}');
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain('json');
    }
  });

  it('returns ok:true for a JSON array (validation will reject it later)', () => {
    const result = parseVkJson('[1,2,3]');
    expect(result.ok).toBe(true);
  });

  it('returns ok:false for empty string', () => {
    const result = parseVkJson('');
    expect(result.ok).toBe(false);
  });
});
