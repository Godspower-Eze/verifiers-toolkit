import { LanguageId } from './types';

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
  /** Default filename shown in the editor. */
  filename: string;
  /** The Circom (or Noir) source code. */
  code: string;
}

// ─── Templates ────────────────────────────────────────────────────────────────

/**
 * Returns the list of built-in circuit templates.
 *
 * Why: A single source of truth — both the API route and tests use this function.
 * How: Returns immutable data; no I/O, fully synchronous.
 */
export function getCircuitTemplates(): CircuitTemplate[] {
  return [MULTIPLIER_TEMPLATE, ADDER_TEMPLATE, CUSTOM_TEMPLATE];
}

// ─── Template definitions ─────────────────────────────────────────────────────

const MULTIPLIER_TEMPLATE: CircuitTemplate = {
  id: 'multiplier',
  name: 'Multiplier',
  language: 'circom',
  filename: 'multiplier.circom',
  description: 'Proves you know two numbers a and b whose product is c, without revealing a or b.',
  code: `pragma circom 2.0.0;

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

component main = Multiplier();
`.trim(),
};

const ADDER_TEMPLATE: CircuitTemplate = {
  id: 'adder',
  name: 'Adder',
  language: 'circom',
  filename: 'adder.circom',
  description: 'Proves you know two private numbers that sum to a public output.',
  code: `pragma circom 2.0.0;

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

component main = Adder();
`.trim(),
};

const CUSTOM_TEMPLATE: CircuitTemplate = {
  id: 'custom',
  name: 'Custom (Blank)',
  language: 'circom',
  filename: 'circuit.circom',
  description: 'Start from scratch with a minimal circuit scaffold.',
  code: `pragma circom 2.0.0;

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
 */
template MyCircuit() {
    signal input  x;
    signal output y;

    y <== x * x;
}

component main = MyCircuit();
`.trim(),
};
