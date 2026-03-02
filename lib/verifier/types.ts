// ─── Proof system discriminator ───────────────────────────────────────────────

/**
 * Supported proof systems for Cairo verifier generation.
 * Only groth16 is implemented currently. Plonk/fflonk can be added here later.
 */
export type ProofSystem = 'groth16' | 'ultra_keccak_zk_honk';

// ─── Scarb Compilation input ──────────────────────────────────────────────────

/**
 * All Cairo and Scarb files needed to compile one contract via `scarb build`.
 * Produced by VerifierGenerator and passed to ScarbCompiler.
 */
export interface ScarbCompileInput {
  /** Sanitised Scarb project name (lowercase, no spaces). */
  projectName: string;
  /** Contents of groth16_verifier.cairo or honk_verifier.cairo — the main contract. */
  verifierCairo: string;
  /** Contents of groth16_verifier_constants.cairo or honk_verifier_constants.cairo — VK constants. */
  constantsCairo: string;
  /** Contents of honk_verifier_circuits.cairo — circuit definitions (Noir/Honk only). Optional for Groth16. */
  circuitsCairo?: string;
  /** Contents of lib.cairo — module declarations. */
  libCairo: string;
  /** Contents of Scarb.toml — build manifest with garaga dependency. */
  scarbToml: string;
}

// ─── Scarb Compilation result ─────────────────────────────────────────────────

/**
 * Result of running `scarb build` via ScarbCompiler.
 * On success, contains the raw Sierra and Casm JSON objects ready for Starknet declaration.
 */
export type ScarbCompileResult =
  | { success: true; sierra: unknown; casm: unknown }
  | { success: false; error: string };

// ─── Verifier generation output ───────────────────────────────────────────────

/**
 * The Cairo project files produced by a successful `garaga gen` run.
 * Passed directly to ScarbCompiler for compilation.
 */
export interface GeneratedVerifier {
  /** Proof system used */
  system: ProofSystem;
  /** Sanitised project / contract name. */
  projectName: string;
  /** Contents of groth16_verifier.cairo or honk_verifier.cairo — the main contract. */
  verifierCairo: string;
  /** Contents of groth16_verifier_constants.cairo or honk_verifier_constants.cairo — VK constants. */
  constantsCairo: string;
  /** Contents of honk_verifier_circuits.cairo — circuit definitions (Noir/Honk only). */
  circuitsCairo?: string;
  /** Contents of lib.cairo — module declarations. */
  libCairo: string;
  /** Contents of Scarb.toml — ready-to-use build manifest. */
  scarbToml: string;
}

/**
 * Result of running `garaga gen` via VerifierGenerator.
 */
export type GenerateResult =
  | { success: true; verifier: GeneratedVerifier }
  | { success: false; error: string };
