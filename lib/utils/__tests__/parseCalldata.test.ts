import { parseCalldataInput } from '../parseCalldata';

describe('parseCalldataInput', () => {
  // ── Empty / null cases ─────────────────────────────────────────────────────

  it('returns null for empty string', () => {
    expect(parseCalldataInput('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseCalldataInput('   ')).toBeNull();
  });

  // ── JSON array format ──────────────────────────────────────────────────────

  it('parses a valid JSON array of hex strings', () => {
    const input = '["0x1a2b", "0x3c4d", "0xdeadbeef"]';
    expect(parseCalldataInput(input)).toEqual(['0x1a2b', '0x3c4d', '0xdeadbeef']);
  });

  it('parses a JSON array with a single element', () => {
    expect(parseCalldataInput('["0xabc"]')).toEqual(['0xabc']);
  });

  it('parses a JSON array of unquoted decimal numbers as felt strings', () => {
    expect(parseCalldataInput('[1, 2, 3]')).toEqual(['1', '2', '3']);
  });

  it('returns null for a JSON object (not an array)', () => {
    expect(parseCalldataInput('{"key": "0x1"}')).toBeNull();
  });

  it('parses a JSON array of decimal strings', () => {
    expect(parseCalldataInput('["123", "456"]')).toEqual(['123', '456']);
  });

  it('parses a JSON array mixing hex and decimal strings', () => {
    expect(parseCalldataInput('["0x1a2b", "999"]')).toEqual(['0x1a2b', '999']);
  });

  it('returns null for a JSON array of non-felt strings', () => {
    expect(parseCalldataInput('["hello", "world"]')).toBeNull();
  });

  // ── Unquoted bracket array format ─────────────────────────────────────────

  it('parses an unquoted bracket array of hex values', () => {
    expect(parseCalldataInput('[0x12, 0x34]')).toEqual(['0x12', '0x34']);
  });

  it('parses an unquoted bracket array of decimal values', () => {
    expect(parseCalldataInput('[123, 456]')).toEqual(['123', '456']);
  });

  it('parses an unquoted bracket array with a single element', () => {
    expect(parseCalldataInput('[0xabc]')).toEqual(['0xabc']);
  });

  it('returns null for an unquoted bracket array with non-felt values', () => {
    expect(parseCalldataInput('[0x1a2b, notHex]')).toBeNull();
  });

  // ── Comma/whitespace-separated format ─────────────────────────────────────

  it('parses comma-separated hex strings', () => {
    expect(parseCalldataInput('0x1a2b, 0x3c4d, 0xdeadbeef')).toEqual([
      '0x1a2b', '0x3c4d', '0xdeadbeef',
    ]);
  });

  it('parses space-separated hex strings', () => {
    expect(parseCalldataInput('0x1a2b 0x3c4d 0xdeadbeef')).toEqual([
      '0x1a2b', '0x3c4d', '0xdeadbeef',
    ]);
  });

  it('parses newline-separated hex strings', () => {
    expect(parseCalldataInput('0x1a2b\n0x3c4d\n0xdeadbeef')).toEqual([
      '0x1a2b', '0x3c4d', '0xdeadbeef',
    ]);
  });

  it('parses comma-separated decimal strings', () => {
    expect(parseCalldataInput('123, 456')).toEqual(['123', '456']);
  });

  it('returns null when some parts are not valid felts', () => {
    expect(parseCalldataInput('0x1a2b, notHex, 0x3c4d')).toBeNull();
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('handles leading/trailing whitespace around a JSON array', () => {
    expect(parseCalldataInput('  ["0xabc", "0xdef"]  ')).toEqual(['0xabc', '0xdef']);
  });

  it('handles mixed commas and spaces as separators', () => {
    expect(parseCalldataInput('0x1,  0x2,0x3')).toEqual(['0x1', '0x2', '0x3']);
  });
});
