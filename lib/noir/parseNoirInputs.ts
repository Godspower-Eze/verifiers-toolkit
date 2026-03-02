import { NoirAbi, NoirAbiType } from '../circom/types';
import { CircomInputTemplate } from '../circom/parseInputSignals';

/**
 * Infer a template of default input values from a compiled Noir ABI.
 *
 * Why use the ABI instead of parsing source:
 *   - The ABI is a first-class compiler output — types and array lengths are
 *     already resolved (no template-parameter ambiguity like Circom's sym).
 *   - Visibility (`pub` vs private) is explicit: all parameters are inputs.
 *   - No secondary file or cross-referencing with source text is required.
 *
 * Mapping:
 *   field | integer | boolean | string → 0
 *   array of length N                 → Array(N).fill(0)
 *   struct | tuple                    → 0  (flat fallback; documented limitation)
 *
 * Return type of fn main is excluded (it is an output, analogous to Circom's
 * `signal output`).
 *
 * The returned object preserves the declaration order of parameters, which
 * matches the order barretenberg's witness expects.
 */
export function parseNoirInputs(abi: NoirAbi): CircomInputTemplate {
  const result: CircomInputTemplate = {};

  for (const param of abi.parameters) {
    result[param.name] = noirTypeToDefault(param.type);
  }

  return result;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Return a zero-valued default for a given NoirAbiType.
 *
 * Scalars (field, integer, boolean, string) → 0.
 * Arrays → number[] of the declared length, all zeroes.
 * Structs / tuples → 0 (flat fallback; complex nested types are rare in
 *   simple circuits and can be enhanced in a future iteration).
 */
function noirTypeToDefault(type: NoirAbiType): number | number[] {
  switch (type.kind) {
    case 'field':
    case 'integer':
    case 'boolean':
    case 'string':
      return 0;

    case 'array': {
      const length = type.length ?? 0;
      return Array<number>(length).fill(0);
    }

    case 'struct':
    case 'tuple':
      // Flat fallback for complex nested types.
      // Limitation: the user will need to manually edit these in the UI.
      return 0;

    default:
      return 0;
  }
}
