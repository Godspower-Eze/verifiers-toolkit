import { VkValidator, parseVkJson } from '@/lib/vk/VkValidator';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A minimal valid SnarkJS BN254 Groth16 VK (1 public input). */
const VALID_VK = {
  protocol: 'groth16',
  curve: 'bn128',
  nPublic: 1,
  vk_alpha_1: ['1', '2', '1'],
  vk_beta_2: [['1', '2'], ['3', '4'], ['1', '0']],
  vk_gamma_2: [['1', '2'], ['3', '4'], ['1', '0']],
  vk_delta_2: [['1', '2'], ['3', '4'], ['1', '0']],
  vk_alphabeta_12: [[['1', '2']], [['3', '4']]],
  IC: [['1', '2', '1'], ['3', '4', '1']],  // length = nPublic + 1 = 2  ✓
};

/** Same VK but with curve "bn254" (Garaga naming). */
const VALID_VK_BN254_NAME = { ...VALID_VK, curve: 'bn254' };

// ─── VkValidator.validate ─────────────────────────────────────────────────────

describe('VkValidator.validate', () => {
  const validator = new VkValidator();

  // ── Success path ────────────────────────────────────────────────────────────

  describe('valid VK', () => {
    it('returns valid:true for a correct BN254 VK (bn128 curve name)', () => {
      const result = validator.validate(VALID_VK);
      expect(result.valid).toBe(true);
    });

    it('returns the parsed vk object on success', () => {
      const result = validator.validate(VALID_VK);
      if (result.valid) {
        expect(result.vk.protocol).toBe('groth16');
        expect(result.vk.nPublic).toBe(1);
      }
    });

    it('accepts "bn254" as a valid curve name', () => {
      const result = validator.validate(VALID_VK_BN254_NAME);
      expect(result.valid).toBe(true);
    });

    it('accepts nPublic = 0 with IC.length = 1', () => {
      const vk = { ...VALID_VK, nPublic: 0, IC: [['1', '2', '1']] };
      expect(validator.validate(vk).valid).toBe(true);
    });

    it('accepts nPublic = 3 with IC.length = 4', () => {
      const vk = {
        ...VALID_VK,
        nPublic: 3,
        IC: [['1'], ['2'], ['3'], ['4']],
      };
      expect(validator.validate(vk).valid).toBe(true);
    });
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

  describe('missing fields', () => {
    it('reports error when protocol is missing', () => {
      const { protocol: _, ...vk } = VALID_VK;
      const result = validator.validate(vk);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'protocol')).toBe(true);
      }
    });

    it('reports error when curve is missing', () => {
      const { curve: _, ...vk } = VALID_VK;
      const result = validator.validate(vk);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'curve')).toBe(true);
      }
    });

    it('reports error when IC is missing', () => {
      const { IC: _, ...vk } = VALID_VK;
      const result = validator.validate(vk);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'IC')).toBe(true);
      }
    });

    it('reports all missing fields at once (not short-circuit)', () => {
      const result = validator.validate({});
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(3);
      }
    });
  });

  // ── Protocol mismatch ────────────────────────────────────────────────────────

  describe('protocol mismatch', () => {
    it('rejects protocol "plonk"', () => {
      const result = validator.validate({ ...VALID_VK, protocol: 'plonk' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'protocol')).toBe(true);
      }
    });
  });

  // ── Curve mismatch ────────────────────────────────────────────────────────────

  describe('curve mismatch', () => {
    it('rejects curve "bls12-381"', () => {
      const result = validator.validate({ ...VALID_VK, curve: 'bls12-381' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'curve')).toBe(true);
      }
    });

    it('error message mentions the received curve name', () => {
      const result = validator.validate({ ...VALID_VK, curve: 'bls12-381' });
      if (!result.valid) {
        const curveError = result.errors.find((e) => e.field === 'curve')!;
        expect(curveError.message).toContain('bls12-381');
      }
    });
  });

  // ── IC length ─────────────────────────────────────────────────────────────────

  describe('IC length mismatch', () => {
    it('rejects IC.length !== nPublic + 1 (too short)', () => {
      const result = validator.validate({ ...VALID_VK, IC: [['1', '2', '1']] }); // need 2
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.field === 'IC')).toBe(true);
      }
    });

    it('rejects IC.length !== nPublic + 1 (too long)', () => {
      const result = validator.validate({
        ...VALID_VK,
        IC: [['1'], ['2'], ['3']],  // need 2, got 3
      });
      expect(result.valid).toBe(false);
    });

    it('rejects non-array IC', () => {
      const result = validator.validate({ ...VALID_VK, IC: 'not-an-array' });
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
