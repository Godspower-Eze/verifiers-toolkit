import * as fs from 'fs';
import * as path from 'path';
import { PublicInputValidator, parsePublicInputJson } from '@/lib/publicInput/PublicInputValidator';

const VALID_PI_DIR = path.join(process.cwd(), 'tmp_public_inputs');

describe('PublicInputValidator.validate', () => {
  const validator = new PublicInputValidator();

  describe('valid Garaga formats', () => {
    if (fs.existsSync(VALID_PI_DIR)) {
      const files = [
        'gnark_public_bn254.json',
        'snarkjs_public_bn254.json'
      ];

      for (const file of files) {
        if (fs.existsSync(path.join(VALID_PI_DIR, file))) {
          it(`validates ${file} successfully`, () => {
            const piJson = JSON.parse(fs.readFileSync(path.join(VALID_PI_DIR, file), 'utf8'));
            const result = validator.validate(piJson);

            if (!result.valid) {
              console.log(`Failed inside test for ${file}:`, result.errors);
            }
            expect(result.valid).toBe(true);

            if (result.valid) {
              if (file.includes('gnark')) {
                expect(result.summary.format).toBe('gnark_object');
              } else {
                expect(result.summary.format).toBe('stark_array');
              }
              expect(result.summary.count).toBeGreaterThan(0);
            }
          });
        }
      }
    } else {
      it.skip('Skipped testing 2 Garaga formats because tmp_public_inputs/ is not present.', () => {});
    }
  });

  describe('invalid shapes', () => {
    
    it('rejects null', () => {
      expect(validator.validate(null).valid).toBe(false);
    });

    it('rejects an empty object', () => {
      const result = validator.validate({});
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].message).toContain('empty');
      }
    });

    it('rejects a string', () => {
      expect(validator.validate('{}').valid).toBe(false);
    });

    it('rejects object with non-numeric strings', () => {
       const result = validator.validate({ a: "test" });
       expect(result.valid).toBe(false);
       if (!result.valid) {
         expect(result.errors.length).toBe(1);
         expect(result.errors[0].message).toContain('Failed to convert');
       }
    });

    it('rejects array with non-numeric strings', () => {
       const result = validator.validate(["0x12", "bad"]);
       expect(result.valid).toBe(false);
       if (!result.valid) {
         expect(result.errors.length).toBe(1);
         expect(result.errors[0].message).toContain('Failed to convert');
         expect(result.errors[0].field).toBe('index_1');
       }
    });
  });
});

describe('parsePublicInputJson', () => {
  it('returns ok:true for valid JSON', () => {
    const result = parsePublicInputJson('{"test": true}');
    expect(result.ok).toBe(true);
  });

  it('returns ok:false for malformed JSON', () => {
    const result = parsePublicInputJson('{bad}');
    expect(result.ok).toBe(false);
  });
});
