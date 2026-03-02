import { LanguageId, SourceFile } from './types';

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
  files: SourceFile[];
  /** Filename of the entry point — must match an entry in `files`. */
  entrypoint: string;
  /**
   * Pre-computed valid example inputs for this circuit.
   * Values are BigInt strings (or arrays of BigInt strings) so they survive
   * JSON round-trips and satisfy snarkjs field-element requirements.
   * Only input signals are included (outputs are excluded).
   */
  defaultInputs?: Record<string, string | string[]>;
}

// ─── Templates ────────────────────────────────────────────────────────────────

/**
 * Returns the list of built-in circuit templates.
 *
 * Why: A single source of truth — both the API route and tests use this function.
 * How: Returns immutable data; no I/O, fully synchronous.
 */
export function getCircuitTemplates(): CircuitTemplate[] {
  return [
    // Circom — Custom first, then ordered by complexity
    CUSTOM_TEMPLATE,
    MULTIPLIER_TEMPLATE,
    ADDER_TEMPLATE,
    HASH_PREIMAGE_TEMPLATE,
    RANGE_PROOF_TEMPLATE,
    MERKLE_MEMBERSHIP_TEMPLATE,
    ANON_VOTING_TEMPLATE,
    EDDSA_VERIFIER_TEMPLATE,
    SEMAPHORE_TEMPLATE,
    // Noir — Custom first, then ordered by complexity
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
  ];
}

// ─── Template definitions ─────────────────────────────────────────────────────

const MULTIPLIER_TEMPLATE: CircuitTemplate = {
  id: 'multiplier',
  name: 'Multiplier',
  language: 'circom',
  entrypoint: 'multiplier.circom',
  description: 'Proves you know two numbers a and b whose product is c, without revealing a or b.',
  defaultInputs: { a: '3', b: '5' },
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
  defaultInputs: { a: '3', b: '5' },
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
  // secret < Baby JubJub subgroup order l.
  // identity commitment = Poseidon([BabyPbk_x, BabyPbk_y]) for this secret.
  // Merkle tree: single member at index 0, all siblings = 0, depth = 10.
  defaultInputs: {
    secret: '1234567890123456789012345678901234567890',
    merkleProofLength: '10',
    merkleProofIndex: '0',
    merkleProofSiblings: ['0','0','0','0','0','0','0','0','0','0'],
    message: '42',
    scope: '1',
  },
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
component main { public [message, scope] } = Semaphore(10);`,
    },
  ],
};

const HASH_PREIMAGE_TEMPLATE: CircuitTemplate = {
  id: 'hash-preimage',
  name: 'Hash Preimage',
  language: 'circom',
  entrypoint: 'hash-preimage.circom',
  description: 'Proves knowledge of a secret whose Poseidon hash equals a public commitment, without revealing the secret.',
  // commitment = Poseidon([1]) = 18586133768512220936620570745912940619677854269274689475585506675881198879027
  defaultInputs: { preimage: '1' },
  files: [
    {
      filename: 'hash-preimage.circom',
      content: `pragma circom 2.0.0;

include "poseidon.circom";

/*
 * HashPreimage — proves knowledge of a private preimage x such that
 * Poseidon(x) = commitment, without revealing x.
 *
 * Use case: commit to a value on-chain (store the hash), then later prove
 * you know the original value without revealing it.
 *
 * Example inputs:
 *   { "preimage": "42" }
 * The circuit will output the Poseidon hash of 42 as the public commitment.
 *
 * Non-linear constraints: ~240 (Poseidon internals)
 */
template HashPreimage() {
    signal input  preimage;    // private: the secret value
    signal output commitment;  // public:  Poseidon(preimage)

    commitment <== Poseidon(1)([preimage]);
}

component main = HashPreimage();`,
    },
  ],
};

const RANGE_PROOF_TEMPLATE: CircuitTemplate = {
  id: 'range-proof',
  name: 'Range Proof',
  language: 'circom',
  entrypoint: 'range-proof.circom',
  description: 'Proves a private value lies within [minValue, maxValue] without revealing the value.',
  // Proves 42 is in [18, 100] (e.g. age-verification style).
  defaultInputs: { value: '42', minValue: '18', maxValue: '100' },
  files: [
    {
      filename: 'range-proof.circom',
      content: `pragma circom 2.0.0;

include "comparators.circom";
include "bitify.circom";

/*
 * RangeProof — proves a private value lies within [minValue, maxValue]
 * without revealing value itself.
 *
 * Parameters:
 *   N = bit width of the value domain. N=32 supports values up to ~4.3 billion.
 *       minValue and maxValue must also fit within N bits.
 *
 * Use cases: age verification (prove age >= 18), credit score thresholds,
 *            bid validity (bid is within [reserve, ceiling]).
 *
 * Example inputs (N=32, prove 42 is in [18, 100]):
 *   { "value": "42", "minValue": "18", "maxValue": "100" }
 *
 * Non-linear constraints: ~N (Num2Bits) + 2 * ~N (LessEqThan)
 */
template RangeProof(N) {
    signal input value;     // private: the value to prove in range
    signal input minValue;  // public:  lower bound (inclusive)
    signal input maxValue;  // public:  upper bound (inclusive)

    // Bit-decompose value — enforces 0 <= value < 2^N (prevents overflow attacks)
    component bits = Num2Bits(N);
    bits.in <== value;

    // value >= minValue  ↔  minValue <= value
    component geMin = LessEqThan(N);
    geMin.in <== [minValue, value];
    geMin.out === 1;

    // value <= maxValue
    component leMax = LessEqThan(N);
    leMax.in <== [value, maxValue];
    leMax.out === 1;
}

// N=32 supports values in [0, 4_294_967_295].
// Reduce N for tighter domains (e.g. N=8 for age proofs: [0, 255]).
component main { public [minValue, maxValue] } = RangeProof(32);`,
    },
  ],
};

const MERKLE_MEMBERSHIP_TEMPLATE: CircuitTemplate = {
  id: 'merkle-membership',
  name: 'Merkle Membership',
  language: 'circom',
  entrypoint: 'merkle-membership.circom',
  description: 'Proves a leaf is a member of a Merkle tree without revealing which leaf or its position.',
  // Leaf 42 at index 0, depth 1, sibling = 0. Circuit outputs the root.
  defaultInputs: {
    leaf: '42',
    merkleProofLength: '1',
    merkleProofIndex: '0',
    merkleProofSiblings: ['0','0','0','0','0','0','0','0','0','0'],
  },
  files: [
    {
      filename: 'merkle-membership.circom',
      content: `pragma circom 2.1.5;

include "poseidon.circom";
include "binary-merkle-root.circom";

/*
 * MerkleMembership — proves a private leaf value exists in a Merkle tree
 * whose root is publicly known, without revealing the leaf or its index.
 *
 * Unlike Semaphore, this circuit works with any raw leaf value (no identity
 * abstraction). Useful for: NFT allowlists, airdrop eligibility, private
 * set membership, anonymous authentication.
 *
 * How the Merkle proof works:
 *   Given a leaf and sibling hashes at each level, BinaryMerkleRoot recomputes
 *   the root. The proof is valid iff the computed root matches the expected root.
 *
 * Example inputs (tree depth 2, leaf at index 0):
 *   {
 *     "leaf": "42",
 *     "merkleProofLength": 2,
 *     "merkleProofIndex": 0,
 *     "merkleProofSiblings": [
 *       "0", "14744269619966411208579211824598458697587494354926760081771325075741142829156",
 *       ...  (pad remaining entries with "0" up to MAX_DEPTH)
 *     ]
 *   }
 *
 * Non-linear constraints: ~MAX_DEPTH * 600 (Poseidon per level)
 */
template MerkleMembership(MAX_DEPTH) {
    // Private inputs — never revealed to the verifier
    signal input leaf;
    signal input merkleProofLength;
    signal input merkleProofIndex;
    signal input merkleProofSiblings[MAX_DEPTH];

    // Public output — the verifier checks this matches the known group root
    signal output root;

    root <== BinaryMerkleRoot(MAX_DEPTH)(
        leaf,
        merkleProofLength,
        merkleProofIndex,
        merkleProofSiblings
    );
}

// MAX_DEPTH = 10 supports groups of up to 2^10 = 1024 members.
component main = MerkleMembership(10);`,
    },
  ],
};

const ANON_VOTING_TEMPLATE: CircuitTemplate = {
  id: 'anon-voting',
  name: 'Anonymous Voting',
  language: 'circom',
  entrypoint: 'anon-voting.circom',
  description: 'Proves a valid binary vote (Yes/No) from an eligible voter, producing a nullifier to prevent double-voting.',
  // vote must be 0 or 1 (binary constraint in circuit).
  defaultInputs: { voterSecret: '12345', vote: '1', proposalId: '7' },
  files: [
    {
      filename: 'anon-voting.circom',
      content: `pragma circom 2.0.0;

include "poseidon.circom";

/*
 * AnonVoting — proves a valid private vote without revealing who voted or
 * how they voted, while preventing double-voting via a nullifier.
 *
 * How it works:
 *   1. Binary constraint: vote * (1 - vote) === 0 forces vote ∈ {0, 1}.
 *   2. Nullifier: Poseidon(voterSecret, proposalId) is unique per voter per
 *      proposal — the smart contract rejects duplicate nullifiers.
 *   3. The actual vote is revealed as voteOut so it can be tallied on-chain.
 *
 * Note: this circuit reveals the vote value. For fully private tallying,
 * combine with homomorphic encryption or a commit-reveal scheme.
 *
 * Example inputs:
 *   { "voterSecret": "12345", "vote": "1", "proposalId": "7" }
 *
 * Non-linear constraints: ~243 (binary check + Poseidon)
 */
template AnonVoting() {
    signal input voterSecret;  // private: voter's secret key
    signal input vote;         // private: 0 = No, 1 = Yes

    signal input proposalId;   // public: identifies the proposal

    signal output nullifier;   // public: Poseidon(voterSecret, proposalId)
    signal output voteOut;     // public: the tallied vote (0 or 1)

    // Binary vote constraint: only 0 or 1 satisfies vote * (1 - vote) = 0
    signal voteBinary <== vote * (1 - vote);
    voteBinary === 0;

    // Nullifier prevents double-voting — unique per (voter, proposal)
    nullifier <== Poseidon(2)([voterSecret, proposalId]);

    voteOut <== vote;
}

component main { public [proposalId] } = AnonVoting();`,
    },
  ],
};

const EDDSA_VERIFIER_TEMPLATE: CircuitTemplate = {
  id: 'eddsa-verifier',
  name: 'EdDSA Verifier',
  language: 'circom',
  entrypoint: 'eddsa-verifier.circom',
  description: 'Proves a valid EdDSA (Baby JubJub) signature over a message without revealing the signing scalar S.',
  // Real Baby JubJub EdDSA-Poseidon signature over M=42.
  // Generated with circomlibjs buildEddsa() using a fixed private key.
  defaultInputs: {
    Ax:  '13277427435165878497778222415993513565335242147425444199013288855685581939618',
    Ay:  '13622229784656158136036771217484571176836296686641868549125388198837476602820',
    R8x: '13581298786764748945767926634947678255205695816657943075246986712575095582642',
    R8y: '5498845679751813183057167314357633427318009721851148417316879603756876857036',
    M:   '42',
    S:   '1369310546525874599579150989531551737564162563202517897956396286619941669406',
  },
  files: [
    {
      filename: 'eddsa-verifier.circom',
      content: `pragma circom 2.0.0;

include "eddsaposeidon.circom";

/*
 * EdDSAVerifier — proves you hold a valid EdDSA signature over a message
 * without revealing the signing scalar S.
 *
 * Baby JubJub curve is used (native to Groth16 over BN254).
 * The signature scheme: R8 = r*Base8, S = r + H(R8, A, M)*sk (mod l)
 *
 * Public signals (known to verifier):
 *   Ax, Ay  — signer's public key (Baby JubJub point)
 *   R8x, R8y — nonce point from the signature
 *   M       — message (field element, e.g. Poseidon hash of the payload)
 *
 * Private signal (kept secret):
 *   S — signature scalar; revealing S would expose the signing key
 *
 * To generate inputs using circomlibjs:
 *   const { buildEddsa } = require('circomlibjs');
 *   const eddsa = await buildEddsa();
 *   const F = eddsa.babyJub.F;
 *   const privateKey = Buffer.from('your-32-byte-key');
 *   const publicKey = eddsa.prv2pub(privateKey);
 *   const msg = F.e(BigInt('42'));
 *   const sig = eddsa.signPoseidon(privateKey, msg);
 *   // Inputs: Ax=F.toObject(publicKey[0]), Ay=F.toObject(publicKey[1]),
 *   //         S=sig.S, R8x=F.toObject(sig.R8[0]), R8y=F.toObject(sig.R8[1]), M=42
 *
 * Non-linear constraints: ~~3500 (EdDSA scalar multiplication)
 */
template EdDSAVerifier() {
    signal input Ax;   // public: signer public key x
    signal input Ay;   // public: signer public key y
    signal input R8x;  // public: signature nonce point x
    signal input R8y;  // public: signature nonce point y
    signal input M;    // public: message (field element)

    signal input S;    // private: signature scalar

    component verifier = EdDSAPoseidonVerifier();
    verifier.enabled <== 1;
    verifier.Ax  <== Ax;
    verifier.Ay  <== Ay;
    verifier.S   <== S;
    verifier.R8x <== R8x;
    verifier.R8y <== R8y;
    verifier.M   <== M;
}

component main { public [Ax, Ay, R8x, R8y, M] } = EdDSAVerifier();`,
    },
  ],
};

// ─── Noir templates ───────────────────────────────────────────────────────────

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
  description: 'Proves a valid anonymous vote with a Poseidon nullifier to prevent double-voting.',
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
  description: 'Showcases Noir native bool type and bitwise operations — no trusted setup required.',
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

const CUSTOM_TEMPLATE: CircuitTemplate = {
  id: 'custom',
  name: 'Custom (Blank)',
  language: 'circom',
  entrypoint: 'circuit.circom',
  description: 'Start from scratch with a minimal circuit scaffold.',
  defaultInputs: { x: '2' },
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
