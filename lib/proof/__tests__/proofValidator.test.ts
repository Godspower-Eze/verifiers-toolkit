import * as fs from 'fs';
import * as path from 'path';
import { ProofValidator, parseProofJson } from '@/lib/proof/ProofValidator';

const VALID_PROOF_DIR = path.join(process.cwd(), 'tmp_proofs');

describe('ProofValidator.validate', () => {
  const validator = new ProofValidator();

  describe('valid Garaga formats', () => {
    if (fs.existsSync(VALID_PROOF_DIR)) {
      const files = [
        'gnark_proof_bn254.json',
        'proof_bls.json',
        'proof_bn254.json',
        'proof_risc0.json',
        'proof_sp1.json',
        'snarkjs_proof_bls12381.json',
        'snarkjs_proof_bn254.json'
      ];

      for (const file of files) {
        if (fs.existsSync(path.join(VALID_PROOF_DIR, file))) {
          it(`validates ${file} successfully directly via validator wrapper`, () => {
            const proofJson = JSON.parse(fs.readFileSync(path.join(VALID_PROOF_DIR, file), 'utf8'));
            const result = validator.validate(proofJson);

            expect(result.valid).toBe(true);

            if (result.valid) {
              if (file.includes('risc0')) {
                expect(result.summary.system).toBe('risc0');
              } else if (file.includes('sp1')) {
                expect(result.summary.system).toBe('sp1');
              } else {
                expect(result.summary.system).toBe('groth16');
                expect(result.summary.curve).toBeDefined();
                expect(result.summary.publicInputsCount).toBeGreaterThanOrEqual(0);
              }
            }
          });
        }
      }
    } else {
      it.skip('Skipped testing 7 Garaga formats because tmp_proofs/ is not present.', () => {});
    }
  });

  describe('invalid shapes', () => {
    it('rejects structurally invalid keys (missing SP1, RISC0, and Groth16 points)', () => {
      const result = validator.validate({ protocol: 'groth16', randomRubbish: true });
      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].message).toContain('Invalid Proof format');
      }
    });
    
    it('rejects null', () => {
      expect(validator.validate(null).valid).toBe(false);
    });

    it('rejects an array', () => {
      expect(validator.validate([]).valid).toBe(false);
    });

    it('rejects a string', () => {
      expect(validator.validate('{}').valid).toBe(false);
    });
  });
});

describe('parseProofJson', () => {
  it('returns ok:true for valid JSON', () => {
    const result = parseProofJson('{"test": true}');
    expect(result.ok).toBe(true);
  });

  it('returns ok:false for malformed JSON', () => {
    const result = parseProofJson('{bad}');
    expect(result.ok).toBe(false);
  });
});
