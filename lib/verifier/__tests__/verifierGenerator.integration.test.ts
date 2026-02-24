import * as fs from 'fs';
import * as path from 'path';
import { VerifierGenerator } from '@/lib/verifier/VerifierGenerator';
import { VkValidator } from '@/lib/vk/VkValidator';
import type { SnarkJsVk } from '@/lib/vk/types';

jest.setTimeout(180_000); // garaga gen can take up to ~2 min first run

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VK_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'snarkjs_vk_bn254.json');

function loadRealVk(): SnarkJsVk {
  const raw = fs.readFileSync(VK_FIXTURE_PATH, 'utf8');
  const result = new VkValidator().validate(JSON.parse(raw));
  if (!result.valid) throw new Error('Test fixture VK is invalid: ' + JSON.stringify(result.errors));
  return result.vk;
}

// ─── VerifierGenerator integration tests ──────────────────────────────────────

describe('VerifierGenerator.generate (real garaga gen)', () => {
  const generator = new VerifierGenerator();
  let vk: SnarkJsVk;

  beforeAll(() => {
    vk = loadRealVk();
  });

  it('returns success:true for a valid BN254 VK', async () => {
    const result = await generator.generate(vk);
    if (!result.success) {
      console.error('garaga gen error:', result.error);
    }
    expect(result.success).toBe(true);
  });

  it('generated verifier contains Cairo contract declaration', async () => {
    const result = await generator.generate(vk);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verifier.verifierCairo).toContain('#[starknet::contract]');
    }
  });

  it('generated verifier contains verify_groth16_proof_bn254 function', async () => {
    const result = await generator.generate(vk);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verifier.verifierCairo).toContain('verify_groth16_proof_bn254');
    }
  });

  it('generated lib.cairo exports the verifier modules', async () => {
    const result = await generator.generate(vk);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verifier.libCairo).toContain('groth16_verifier');
    }
  });

  it('generated Scarb.toml has garaga dependency', async () => {
    const result = await generator.generate(vk);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verifier.scarbToml).toContain('garaga');
    }
  });

  it('generated constants file contains N_PUBLIC_INPUTS', async () => {
    const result = await generator.generate(vk);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verifier.constantsCairo).toContain('N_PUBLIC_INPUTS');
    }
  });

  it('uses the sanitised project name in Scarb.toml', async () => {
    const result = await generator.generate(vk, 'My Test Verifier!');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verifier.projectName).toBe('my_test_verifier_');
      expect(result.verifier.scarbToml).toContain('my_test_verifier_');
    }
  });

  it('temp directory is cleaned up after generation', async () => {
    const os = await import('os');
    const beforeFiles = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('garaga-gen-'));
    await generator.generate(vk);
    const afterFiles = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('garaga-gen-'));
    expect(afterFiles.length).toBe(beforeFiles.length);
  });
});
