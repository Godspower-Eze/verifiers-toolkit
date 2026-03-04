/**
 * parseCalldataInput — parses a raw calldata string into a string array.
 *
 * Accepts three formats:
 *   1. JSON array of felt strings:    ["123", "0x1a2b", ...]
 *   2. Unquoted bracket array:        [123, 0x1a2b, ...]
 *   3. Comma or whitespace-separated: 123, 0x1a2b ...
 *
 * Each element must be a decimal integer or a 0x-prefixed hex string.
 * Returns null if the input is empty or cannot be parsed into a valid array.
 */

/** Matches a single Starknet felt252 value: decimal or 0x-prefixed hex. */
const FELT_RE = /^(0x[0-9a-fA-F]+|[0-9]+)$/;

export function parseCalldataInput(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try JSON array first (handles ["123", "0x1a2b"])
  try {
    const parsed = JSON.parse(trimmed);
    if (
      Array.isArray(parsed) &&
      parsed.every((v) => typeof v === 'string' && FELT_RE.test(v))
    ) {
      return parsed;
    }
  } catch {}

  // Strip optional surrounding brackets to handle [123, 0x1a2b]
  const inner =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;

  // Fall back to comma/whitespace-separated felts
  const parts = inner.split(/[\s,]+/).filter(Boolean);
  if (parts.length > 0 && parts.every((p) => FELT_RE.test(p))) {
    return parts;
  }

  return null;
}
