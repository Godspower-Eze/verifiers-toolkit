import { LanguageId, CircomFile } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CircuitTemplate {
  /** Unique identifier (stable across renames). */
  id: string;
  /** Human-readable name shown in the picker. */
  name: string;
  /** One-line description of what the circuit does. */
  description: string;
  /** The language this template is written in. */
  language: LanguageId;
  /** All files in the template project. */
  files: CircomFile[];
  /** Filename of the entry point — must match an entry in `files`. */
  entrypoint: string;
}

// ─── Templates ────────────────────────────────────────────────────────────────

/**
 * Returns the list of built-in circuit templates.
 *
 * Why: A single source of truth — both the API route and tests use this function.
 * How: Returns immutable data; no I/O, fully synchronous.
 */
export function getCircuitTemplates(): CircuitTemplate[] {
  return [MULTIPLIER_TEMPLATE, ADDER_TEMPLATE, SEMAPHORE_TEMPLATE, CUSTOM_TEMPLATE];
}

// ─── Template definitions ─────────────────────────────────────────────────────

const MULTIPLIER_TEMPLATE: CircuitTemplate = {
  id: 'multiplier',
  name: 'Multiplier',
  language: 'circom',
  entrypoint: 'multiplier.circom',
  description: 'Proves you know two numbers a and b whose product is c, without revealing a or b.',
  files: [
    {
      filename: 'multiplier.circom',
      content: `pragma circom 2.0.0;

/*
 * Multiplier — proves knowledge of factors a, b such that a * b = c.
 * This is the canonical "hello world" Groth16 circuit.
 * Non-linear constraints: 1
 */
template Multiplier() {
    signal input  a;   // private: first factor
    signal input  b;   // private: second factor
    signal output c;   // public:  product

    c <== a * b;
}

component main = Multiplier();`,
    },
  ],
};

const ADDER_TEMPLATE: CircuitTemplate = {
  id: 'adder',
  name: 'Adder',
  language: 'circom',
  entrypoint: 'adder.circom',
  description: 'Proves you know two private numbers that sum to a public output.',
  files: [
    {
      filename: 'adder.circom',
      content: `pragma circom 2.0.0;

/*
 * Adder — proves knowledge of a, b such that a + b = out.
 * Addition is linear (no multiplication), so it uses 0 non-linear constraints.
 * A small non-linear "range" constraint is added to make it a valid Groth16 circuit.
 */
template Adder() {
    signal input  a;        // private
    signal input  b;        // private
    signal output out;      // public: sum

    out <== a + b;

    // Dummy non-linear constraint so the circuit has at least one R1CS row.
    signal dummy;
    dummy <== a * b;
}

component main = Adder();`,
    },
  ],
};

const SEMAPHORE_TEMPLATE: CircuitTemplate = {
  id: 'semaphore',
  name: 'Semaphore',
  language: 'circom',
  entrypoint: 'semaphore.circom',
  description: 'Semaphore v4 — anonymous group membership and nullifier proof using BabyJubJub + Poseidon.',
  files: [
    {
      filename: 'semaphore.circom',
      content: `pragma circom 2.1.5;

// External library dependencies (resolved from circomlib + @zk-kit):
include "babyjub.circom";
include "poseidon.circom";
include "binary-merkle-root.circom";
include "comparators.circom";

// The Semaphore circuit can be divided into 3 main parts.
// 1. Identity generation: derives the EdDSA public key (Ax, Ay) from the secret
//    scalar and computes identityCommitment = Poseidon(Ax, Ay).
// 2. Group membership: verifies identityCommitment is a leaf in the Merkle tree
//    via BinaryMerkleRoot.
// 3. Nullifier: nullifier = Poseidon(scope, secret) prevents double-spending.
//
// References:
//   https://github.com/semaphore-protocol/semaphore
//   https://github.com/privacy-scaling-explorations/zk-kit.circom
template Semaphore(MAX_DEPTH) {
    // Private inputs
    signal input secret;
    signal input merkleProofLength, merkleProofIndex, merkleProofSiblings[MAX_DEPTH];

    // Public inputs
    signal input message;
    signal input scope;

    // Public outputs
    signal output merkleRoot, nullifier;

    // The secret scalar must be in the Baby Jubjub prime subgroup order 'l'.
    var l = 2736030358979909402780800718157159386076813972158567259200215660948447373041;

    component isLessThan = LessThan(251);
    isLessThan.in <== [secret, l];
    isLessThan.out === 1;

    // Identity generation — derive public key from secret via Baby Jubjub.
    var Ax, Ay;
    (Ax, Ay) = BabyPbk()(secret);
    var identityCommitment = Poseidon(2)([Ax, Ay]);

    // Proof of group membership via binary Merkle tree.
    merkleRoot <== BinaryMerkleRoot(MAX_DEPTH)(identityCommitment, merkleProofLength, merkleProofIndex, merkleProofSiblings);

    // Nullifier — scoped to prevent double-spending/double-voting.
    nullifier <== Poseidon(2)([scope, secret]);

    // Malleability guard: force compiler to constrain the message signal.
    // See https://geometry.xyz/notebook/groth16-malleability
    signal dummySquare <== message * message;
}

// MAX_DEPTH = 10 supports groups of up to 2^10 = 1024 members.
// Increase for larger groups (at the cost of more constraints).
component main { public [merkleProofLength, merkleProofIndex, merkleProofSiblings, message, scope] } = Semaphore(10);`,
    },
  ],
};

const CUSTOM_TEMPLATE: CircuitTemplate = {
  id: 'custom',
  name: 'Custom (Blank)',
  language: 'circom',
  entrypoint: 'circuit.circom',
  description: 'Start from scratch with a minimal circuit scaffold.',
  files: [
    {
      filename: 'circuit.circom',
      content: `pragma circom 2.0.0;

/*
 * Write your circuit here.
 *
 * Quick reference:
 *   signal input  x;      // private input
 *   signal output y;      // public output
 *   y <== x * x;          // non-linear constraint (quadratic)
 *   y <== x + 1;          // linear constraint (free in R1CS)
 *
 * Groth16 proof size is constant regardless of circuit complexity.
 * Proving time scales with the number of non-linear constraints.
 *
 * To import circomlib:
 *   include "poseidon.circom";   // Poseidon hash
 *   include "comparators.circom"; // LessThan, IsEqual, etc.
 *   include "babyjub.circom";    // Baby JubJub curve
 */
template MyCircuit() {
    signal input  x;
    signal output y;

    y <== x * x;
}

component main = MyCircuit();`,
    },
  ],
};
