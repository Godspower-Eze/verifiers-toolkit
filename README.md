# Cairo Verifiers Toolkit

A web-based toolkit for generating and deploying on-chain ZK verifier contracts for Starknet — from raw circuits all the way to live on-chain verification.

**Live site:** [verifierstoolkit.xyz](https://verifierstoolkit.xyz)

---

## What it does

The toolkit covers three workflows, each producing a deployed Cairo verifier on Starknet.

### 1. Circuit → Verifier

Write a Circom or Noir circuit and the toolkit handles every step end-to-end:

| Step | Circom (Groth16) | Noir (UltraHonk) |
|------|-----------------|-----------------|
| Compile | `.circom` → R1CS | `.nr` → ACIR |
| Setup | Trusted setup via SnarkJS + PTAU | Proving key via Barretenberg |
| Prove | Generate proof + public inputs | Generate proof + public inputs |
| Generate verifier | Groth16 Cairo verifier via Garaga | UltraHonk Cairo verifier via Garaga |
| Compile verifier | Scarb | Scarb |
| Deploy | Starknet (Sepolia / Mainnet) | Starknet (Sepolia / Mainnet) |
| Verify on-chain | Submit verification key, proof, and public inputs — calldata generated off-chain (BN254 or BLS12-381) | Submit verification key, proof, and public inputs — calldata generated off-chain |

### 2. Verification Key → Verifier

Already have a verification key? Skip the circuit and proving steps entirely. Upload a `verification_key.json` (Groth16) or the equivalent UltraHonk VK, and the toolkit generates, compiles, and deploys a Cairo verifier contract directly from it.

### 3. Verify a Proof

Have a deployed verifier, a proof, and public inputs? Submit them together to perform on-chain verification against any previously deployed contract — no redeployment needed.

---

## Supported proof systems

| Proof system | Circuit language | Backend |
|-------------|-----------------|---------|
| Groth16 | Circom | SnarkJS |
| UltraHonk | Noir | Barretenberg (bb) |

---

## Tech stack

- [Next.js](https://nextjs.org) — frontend and API routes
- [SnarkJS](https://github.com/iden3/snarkjs) — Groth16 proving backend
- [Noir / Barretenberg](https://noir-lang.org) — UltraHonk proving backend
- [Garaga](https://github.com/keep-starknet-strange/garaga) — Cairo verifier generation
- [Starknet.js](https://www.starknetjs.com) — wallet connection and on-chain deployment
