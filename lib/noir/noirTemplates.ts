import { CircuitTemplate } from '@/lib/circom/types';

// ─── Noir circuit templates ───────────────────────────────────────────────────
//
// All templates use std::hash::pedersen_hash (confirmed available in nargo
// 1.0.0-beta.16). poseidon::bn254 and std::merkle are not accessible.
//
// Important: avoid `||` inside assert() — nargo 1.0.0-beta.16 parses it as
// OR-patterns instead of boolean OR. Use algebraic constraints instead.

const NOIR_CUSTOM_TEMPLATE: CircuitTemplate = {
  id: 'noir-custom',
  name: 'Custom (Blank)',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Start from scratch with a minimal Noir circuit scaffold. No trusted setup required.',
  defaultInputs: { x: '1' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Write your Noir circuit here.
//
// Quick reference:
//   fn main(x: Field)          private input (not revealed to verifier)
//   fn main(x: pub Field)      public input (verifier knows this value)
//   fn main(x: Field) -> Field public return value
//   assert(expr, "msg")        constraint - proof fails if expr is false
//   u32, u64, i32, bool        native integer and boolean types
//
// Noir uses UltraHonk: no trusted setup (no .ptau / .zkey files needed).
// Proving time scales with circuit depth, not number of constraints alone.
//
// Available standard library functions:
//   std::hash::pedersen_hash([x])        Pedersen hash (BN254)

fn main(x: Field) {
    // Add your constraints here
    assert(x != 0, "x must be non-zero");
}`,
    },
  ],
};

const NOIR_MULTIPLIER_TEMPLATE: CircuitTemplate = {
  id: 'noir-multiplier',
  name: 'Multiplier',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Proves you know two numbers a and b whose product equals a public output.',
  defaultInputs: { a: '3', b: '5' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Multiplier - proves knowledge of a, b such that a * b = result.
//
// Unlike Circom, Noir uses UltraHonk: no trusted setup is required.
// All Field elements are 252-bit integers over BN254.
//
// \`pub\` marks values that appear in the public inputs of the proof.
// Private inputs (a) are kept secret from the verifier.

fn main(a: Field, b: pub Field) -> pub Field {
    a * b
}`,
    },
  ],
};

const NOIR_ADDER_TEMPLATE: CircuitTemplate = {
  id: 'noir-adder',
  name: 'Adder',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Proves you know two private numbers that sum to a public output.',
  defaultInputs: { a: '3', b: '5' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Adder - proves knowledge of a, b such that a + b = result.
//
// Addition is a linear operation over BN254 field elements, so this circuit
// has essentially zero non-linear gates (unlike Circom's Adder which needs
// a dummy multiplier to satisfy Groth16's R1CS format).
//
// UltraHonk handles linear constraints natively without R1CS overhead.

fn main(a: Field, b: Field) -> pub Field {
    a + b
}`,
    },
  ],
};

const NOIR_SEMAPHORE_TEMPLATE: CircuitTemplate = {
  id: 'noir-semaphore',
  name: 'Semaphore',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Semaphore-style anonymous group membership and nullifier proof using Pedersen hash + inline Merkle tree.',
  // Tree of depth 10 with a single member (secret=42) at index 0, all siblings = 0.
  // Root pre-computed: pedersen_merkle(pedersen_hash([42]), index=0, hashpath=all-zeros)
  defaultInputs: {
    secret: '42',
    index: '0',
    hashpath: ['0','0','0','0','0','0','0','0','0','0'],
    scope: '1',
    root: '4189320995972071331910947569569706795624531588707567389752741894386138569054',
  },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Semaphore - anonymous group membership and nullifier proof
//
// Proves membership in a Merkle group without revealing identity,
// and emits a scoped nullifier to prevent double-spending/double-voting.
//
// Identity commitment = pedersen_hash(secret)
// Group membership: Merkle path from commitment to the public root
// Nullifier = pedersen_hash(scope, secret) - unique per (user, scope)
//
// All siblings in hashpath default to 0 (empty subtree).
// The root is a public input: the verifier checks it matches the known group root.

fn hash_pair(left: Field, right: Field) -> Field {
    std::hash::pedersen_hash([left, right])
}

fn main(
    secret: Field,
    index: Field,
    hashpath: [Field; 10],
    scope: pub Field,
    root: pub Field,
) -> pub Field {
    // Derive identity commitment from secret
    let commitment = std::hash::pedersen_hash([secret]);

    // Reconstruct Merkle root from commitment + sibling path
    let bits: [u1; 10] = index.to_le_bits();
    let mut current = commitment;
    for i in 0..10 {
        let sibling = hashpath[i];
        current = if bits[i] == 1 {
            hash_pair(sibling, current)
        } else {
            hash_pair(current, sibling)
        };
    }

    // Verify membership: computed root must match the known group root
    assert(current == root, "Not a member of the group");

    // Nullifier prevents double-spending - unique per (secret, scope)
    std::hash::pedersen_hash([scope, secret])
}`,
    },
  ],
};

const NOIR_HASH_PREIMAGE_TEMPLATE: CircuitTemplate = {
  id: 'noir-hash-preimage',
  name: 'Hash Preimage',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Proves knowledge of a secret whose Pedersen hash equals a public commitment.',
  // commitment = pedersen_hash([1]) = 0x035...ce8e
  defaultInputs: { preimage: '1', commitment: '1505662313093145631275418581390771847921541863527840230091007112166041775502' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Hash Preimage - proves knowledge of a private preimage such that
// pedersen_hash(preimage) = commitment, without revealing the preimage.
//
// std::hash::pedersen_hash computes a Pedersen hash over BN254.
// The commitment is returned as the function's public output.
//
// Use case: commit to a value on-chain (store the hash), then later prove
// you know the original value without revealing it.

fn main(preimage: Field, commitment: pub Field) {
    let computed = std::hash::pedersen_hash([preimage]);
    assert(computed == commitment, "Preimage does not match commitment");
}`,
    },
  ],
};

const NOIR_COMMITMENT_TEMPLATE: CircuitTemplate = {
  id: 'noir-commitment',
  name: 'Commitment',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Proves knowledge of a secret and blinding factor whose Pedersen commitment equals a public value.',
  defaultInputs: { secret: '42', blinding: '7' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Pedersen Commitment
//
// Proves knowledge of (secret, blinding) such that
//   commitment = pedersen_hash(secret, blinding)
// without revealing secret or blinding.
//
// Use case: commit to a value off-chain (publish the hash), then later
// prove ownership of the committed value in a ZK proof - e.g. blind auctions,
// voting precommitments, or private identity attributes.
//
// The commitment is returned as the function's public output.
// The verifier sees commitment but not secret or blinding.

fn main(secret: Field, blinding: Field) -> pub Field {
    std::hash::pedersen_hash([secret, blinding])
}`,
    },
  ],
};

const NOIR_RANGE_PROOF_TEMPLATE: CircuitTemplate = {
  id: 'noir-range-proof',
  name: 'Range Proof',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Proves a private value lies within [0, max_value) using native Noir integer bounds, with no trusted setup.',
  defaultInputs: { value: '42', max_value: '100' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Range Proof - proves a private value lies within [0, max_value)
// without revealing the value itself.
//
// u32 is a native 32-bit unsigned integer type in Noir. The compiler
// automatically enforces that u32 values satisfy 0 <= value < 2^32,
// eliminating the need for explicit bit-decomposition (unlike Circom).
//
// assert() creates a constraint: the proof is invalid if the assertion fails.
// max_value is public so the verifier knows the claimed upper bound.
//
// Use cases: age verification (prove age >= 18), bid validity checks,
//            credit score thresholds, salary range proofs.

fn main(value: u32, max_value: pub u32) {
    assert(value < max_value, "Value is not less than the maximum");
}`,
    },
  ],
};

const NOIR_MERKLE_MEMBERSHIP_TEMPLATE: CircuitTemplate = {
  id: 'noir-merkle-membership',
  name: 'Merkle Membership',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Proves a private leaf is a member of a Merkle tree without revealing the leaf or its position.',
  defaultInputs: {
    leaf: '42',
    index: '0',
    hashpath: ['0', '0', '0'],
  },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Merkle Membership (depth 3 = up to 8 members)
//
// Proves a private leaf exists in a Merkle tree whose root is the
// publicly returned value, without revealing the leaf or its index.
//
// hashpath[i] is the sibling hash at level i (leaf to root).
// index encodes the position as a 3-bit integer (0-7).
// We reconstruct the root level-by-level using pedersen_hash(left, right).
//
// Use cases: NFT allowlists, airdrop eligibility, anonymous authentication,
//            private set membership proofs.

fn hash_pair(left: Field, right: Field) -> Field {
    std::hash::pedersen_hash([left, right])
}

fn main(leaf: Field, index: Field, hashpath: [Field; 3]) -> pub Field {
    let bits: [u1; 3] = index.to_le_bits();
    let (l0, r0) = if bits[0] == 1 { (hashpath[0], leaf) } else { (leaf, hashpath[0]) };
    let h0 = hash_pair(l0, r0);
    let (l1, r1) = if bits[1] == 1 { (hashpath[1], h0) } else { (h0, hashpath[1]) };
    let h1 = hash_pair(l1, r1);
    let (l2, r2) = if bits[2] == 1 { (hashpath[2], h1) } else { (h1, hashpath[2]) };
    hash_pair(l2, r2)
}`,
    },
  ],
};

const NOIR_ANON_VOTING_TEMPLATE: CircuitTemplate = {
  id: 'noir-anon-voting',
  name: 'Anonymous Voting',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Proves a valid anonymous vote with a Pedersen nullifier to prevent double-voting.',
  defaultInputs: { voter_secret: '12345', vote: '1', proposal_id: '7' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Anonymous Voting
//
// Proves a valid anonymous vote (0 = No, 1 = Yes) from an eligible voter,
// producing a nullifier to prevent double-voting.
//
// How it works:
//   1. vote * (1 - vote) == 0 is the algebraic binary constraint for {0, 1}.
//   2. nullifier = pedersen_hash(voter_secret, proposal_id) - unique per
//      voter per proposal. The smart contract rejects duplicate nullifiers.
//   3. The nullifier is public, vote and voter_secret are private.

fn main(voter_secret: Field, vote: Field, proposal_id: pub Field) -> pub Field {
    // Algebraic binary constraint: only 0 or 1 satisfies vote * (1 - vote) = 0
    assert(vote * (1 - vote) == 0, "Vote must be 0 or 1");

    // Nullifier prevents double-voting - unique per (voter, proposal)
    std::hash::pedersen_hash([voter_secret, proposal_id])
}`,
    },
  ],
};

const NOIR_BOOLEAN_LOGIC_TEMPLATE: CircuitTemplate = {
  id: 'noir-boolean-logic',
  name: 'Boolean Logic',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Showcases Noir native u32 bitwise AND with no trusted setup required.',
  defaultInputs: { a: '12', b: '10', expected_and: '8' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Boolean Logic - native integer bitwise operations
//
// Demonstrates Noir's native u32 bitwise AND, with the result publicly
// asserted. Equivalent logic in Circom would require bit-decomposition
// (~32 non-linear constraints per bit) - Noir handles it natively.
//
// Examples:
//   12 & 10 = 8    (binary: 1100 & 1010 = 1000)
//   255 & 127 = 127
//   7 & 5 = 5
//
// Use cases: bitmask checks (permission flags, feature flags),
//            low-level cryptographic operations, bitfield proofs.

fn main(a: u32, b: u32, expected_and: pub u32) {
    let result = a & b;
    assert(result == expected_and, "Bitwise AND result does not match expected");
}`,
    },
  ],
};

const NOIR_MULTIPLE_PUBLIC_TEMPLATE: CircuitTemplate = {
  id: 'noir-multiple-public',
  name: 'Multiple Public Inputs',
  language: 'noir',
  entrypoint: 'src/main.nr',
  description: 'Demonstrates multiple public inputs - proves you know x such that x * y = result and x + y = sum.',
  defaultInputs: { x: '3', y: '5', result: '15', sum: '8' },
  files: [
    {
      filename: 'src/main.nr',
      content: `// Multiple Public Inputs - demonstrates circuit with multiple public outputs.
//
// This circuit proves knowledge of secret x and y such that:
//   - x * y = result   (public)
//   - x + y = sum     (public)
//
// Public inputs (all marked with 'pub'):
//   result = x * y    (public output 0)
//   sum = x + y       (public output 1)
//
// The verifier will know result and sum, but not x or y.

fn main(x: Field, y: pub Field, result: pub Field, sum: pub Field) {
    assert(x * y == result, "Product mismatch");
    assert(x + y == sum, "Sum mismatch");
}`,
    },
  ],
};

/**
 * Returns all built-in Noir circuit templates.
 * Custom template first, then ordered by increasing complexity.
 */
export function getNoirTemplates(): CircuitTemplate[] {
  return [
    NOIR_CUSTOM_TEMPLATE,
    NOIR_MULTIPLIER_TEMPLATE,
    NOIR_ADDER_TEMPLATE,
    NOIR_SEMAPHORE_TEMPLATE,
    NOIR_HASH_PREIMAGE_TEMPLATE,
    NOIR_COMMITMENT_TEMPLATE,
    NOIR_RANGE_PROOF_TEMPLATE,
    NOIR_MERKLE_MEMBERSHIP_TEMPLATE,
    NOIR_ANON_VOTING_TEMPLATE,
    NOIR_BOOLEAN_LOGIC_TEMPLATE,
    NOIR_MULTIPLE_PUBLIC_TEMPLATE,
  ];
}
