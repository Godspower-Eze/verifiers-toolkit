import { ScarbCompiler } from '../ScarbCompiler';

// This test requires scarb installed locally
describe('ScarbCompiler (integration)', () => {
  const compiler = new ScarbCompiler();

  it('compiles a valid Scarb project into Sierra and Casm JSONs', async () => {
    // Minimal Scarb.toml that requests starknet-contract output
    const scarbToml = `
[package]
name = "dummy_project"
version = "0.1.0"
edition = "2024_07"

[dependencies]
starknet = "2.8.2"

[[target.starknet-contract]]
sierra = true
casm = true
`;

    const libCairo = `
pub mod groth16_verifier;
pub mod groth16_verifier_constants;
`;

    const constantsCairo = `
// arbitrary constants file
pub fn dummy_const() -> felt252 { 42 }
`;

    const verifierCairo = `
#[starknet::contract]
pub mod Groth16Verifier {
    #[storage]
    struct Storage {}
}
`;

    const result = await compiler.compile({
      projectName: 'dummy_project',
      scarbToml,
      libCairo,
      constantsCairo,
      verifierCairo,
    });

    // Handle failure for better test logs
    if (!result.success) {
      console.error(result.error);
    }

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sierra).toBeDefined();
      expect(result.casm).toBeDefined();

      // Basic structure validation
      expect(result.sierra.sierra_program).toBeInstanceOf(Array);
      expect(result.casm.bytecode).toBeInstanceOf(Array);
    }
  }, 300_000); // 5m timeout for compilation

  it('returns structured error on invalid Cairo code', async () => {
    const scarbToml = `
[package]
name = "dummy_project"
version = "0.1.0"

[dependencies]
starknet = "2.8.2"

[[target.starknet-contract]]
sierra = true
casm = true
`;

    const result = await compiler.compile({
      projectName: 'dummy_project',
      scarbToml,
      libCairo: 'mod non_existent;', // Will cause compilation failure
      constantsCairo: '',
      verifierCairo: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('scarb build failed');
    }
  });
});
