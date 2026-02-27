/**
 * Utility for inferring a circuit's input signal template from compilation artefacts.
 *
 * Two strategies are provided:
 *  1. parseSymInputSignals  — primary, uses the compiled .sym file (accurate)
 *  2. parseCircomInputSignals — fallback, regex over source (limited)
 *
 * The sym-based approach correctly handles:
 *  - Template-parameter arrays:  `signal input a[MAX_DEPTH]`  (size only known after compilation)
 *  - Comma-separated declarations: `signal input a, b, c[N];`
 *  - Excludes intermediate signals (e.g. `signal dummySquare`) and sub-component wires
 *
 * Output format matches what snarkjs `groth16 fullprove` expects:
 *  - Scalar: { "a": 0 }
 *  - Array:  { "siblings": [0, 0, 0] }   ← JSON array, NOT flat "siblings[0]" keys
 */

/** Template object passed to the Prove step as the initial signals JSON. */
export type CircomInputTemplate = Record<string, number | number[]>;

// ─── Primary: sym-based ───────────────────────────────────────────────────────

/**
 * Parses a Circom .sym file to extract input signal names for the `main`
 * component and returns a template with each signal defaulted to 0.
 *
 * Sym file line format:  wireIdx,labelIdx,constraintIdx,signalPath
 *   e.g.  "6,1,0,main.merkleProofSiblings[0]"
 *
 * Algorithm:
 *   1. Parse `signal input` declarations from the entrypoint source to get the
 *      set of valid input base names. This positively identifies inputs and
 *      naturally excludes outputs, intermediate signals, and constants.
 *   2. First pass over sym: collect array groups (base name → sparse index map).
 *   3. Second pass over sym: emit results in sym-file order (preserving the
 *      signal order the compiler assigned, which matches the R1CS wire order).
 *      Arrays are emitted as a single key with a number[] value.
 */
export function parseSymInputSignals(
  symContent: string,
  entrypointSource: string,
): CircomInputTemplate {
  // ── Step 1: collect input base names from `signal input` declarations ──────
  // Handles: "signal input a;"  and  "signal input a, b, c[N];"
  const inputNames = new Set<string>();
  const inputRegex = /signal\s+input\s+([\w,\s\[\]]+?);/g;
  let m: RegExpExecArray | null;
  while ((m = inputRegex.exec(entrypointSource)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().match(/^(\w+)/)?.[1];
      if (name) inputNames.add(name);
    }
  }

  if (inputNames.size === 0) return {};

  const lines = symContent.split('\n');

  // ── Step 2: first pass — build array index maps ───────────────────────────
  const arrays: Record<string, number[]> = {};

  for (const line of lines) {
    const { baseName, idx } = parseLine(line);
    if (baseName === null || idx === null) continue;
    if (!inputNames.has(baseName)) continue;
    if (!arrays[baseName]) arrays[baseName] = [];
    arrays[baseName][idx] = 0;
  }

  // ── Step 3: second pass — emit in sym order, de-duplicated ────────────────
  const result: CircomInputTemplate = {};
  const seen = new Set<string>();

  for (const line of lines) {
    const { baseName, idx } = parseLine(line);
    if (baseName === null) continue;
    if (!inputNames.has(baseName) || seen.has(baseName)) continue;
    seen.add(baseName);

    result[baseName] = idx !== null ? arrays[baseName] : 0;
  }

  return result;
}

// ─── Fallback: regex-based ────────────────────────────────────────────────────

/**
 * Regex-based fallback for when the .sym file is unavailable.
 *
 * Limitations (reasons to prefer parseSymInputSignals):
 *  - Skips template-parameter arrays like `signal input a[MAX_DEPTH]`
 *  - Misses signals in comma-separated declarations
 */
export function parseCircomInputSignals(source: string): CircomInputTemplate {
  const result: CircomInputTemplate = {};
  const arrayNames = new Set<string>();

  const arrayRegex = /signal\s+input\s+(\w+)\s*\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrayRegex.exec(source)) !== null) {
    const name = m[1];
    const size = parseInt(m[2], 10);
    arrayNames.add(name);
    result[name] = Array<number>(size).fill(0);
  }

  const scalarRegex = /signal\s+input\s+(\w+)\s*;/g;
  while ((m = scalarRegex.exec(source)) !== null) {
    const name = m[1];
    if (!arrayNames.has(name)) result[name] = 0;
  }

  return result;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface ParsedLine {
  /** Signal base name under main (e.g. "merkleProofSiblings"), or null to skip. */
  baseName: string | null;
  /** Array index if the signal is an element, or null for scalars. */
  idx: number | null;
}

/**
 * Parses one sym file line.
 *
 * Returns { baseName: null } for lines that should be skipped:
 *   - Malformed (no comma)
 *   - Not under main  (e.g. "0,0,0,one")
 *   - Sub-component   (e.g. "main.isLessThan.n2b.in[0]")
 */
function parseLine(line: string): ParsedLine {
  const skip = { baseName: null, idx: null };

  const comma = line.lastIndexOf(',');
  if (comma === -1) return skip;

  const signalPath = line.slice(comma + 1).trim();
  if (!signalPath.startsWith('main.')) return skip;

  const rest = signalPath.slice('main.'.length); // e.g. "merkleProofSiblings[0]"
  if (rest.includes('.')) return skip;            // sub-component internal wire

  // Array element: "name[idx]"
  const arrayMatch = rest.match(/^(\w+)\[(\d+)\]$/);
  if (arrayMatch) {
    return { baseName: arrayMatch[1], idx: parseInt(arrayMatch[2], 10) };
  }

  // Scalar: "name"
  const scalarMatch = rest.match(/^(\w+)$/);
  if (scalarMatch) {
    return { baseName: scalarMatch[1], idx: null };
  }

  return skip;
}
