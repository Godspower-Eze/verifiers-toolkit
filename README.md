# Cairo Verifiers Toolkit

A web-based toolkit for compiling ZK circuits and generating on-chain Cairo verifiers for Starknet.

**Live site:** [verifierstoolkit.xyz](https://verifierstoolkit.xyz)

## What it does

Write a Circom or Noir circuit, and the toolkit walks you through every step needed to deploy a working verifier contract on Starknet:

1. **Compile** — compile your circuit (Circom → R1CS or Noir → ACIR)
2. **Setup** — run the trusted setup and generate proving / verification keys
3. **Prove** — generate a proof against a witness
4. **Generate verifier** — produce a Cairo verifier contract powered by [Garaga](https://github.com/keep-starknet-strange/garaga)
5. **Compile verifier** — compile the Cairo contract with Scarb
6. **Deploy** — deploy the verifier to Starknet
7. **Verify on-chain** — submit a proof and public inputs for on-chain verification

Supports **Groth16** (via Circom + SnarkJS) and **UltraHonk** (via Noir + Barretenberg).

## Tech stack

- [Next.js](https://nextjs.org) — frontend and API routes
- [SnarkJS](https://github.com/iden3/snarkjs) — Groth16 proving backend
- [Noir / Barretenberg](https://noir-lang.org) — UltraHonk proving backend
- [Garaga](https://github.com/keep-starknet-strange/garaga) — Cairo verifier generation
- [Starknet.js](https://www.starknetjs.com) — wallet connection and on-chain deployment
