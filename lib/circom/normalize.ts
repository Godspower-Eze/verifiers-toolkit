import { CompileError, RawCompileOutput } from './types';

// ─── Known circom stderr patterns ─────────────────────────────────────────────
// Matched against real circom stderr output.
// Real format example:
//   error[P1012]: UnrecognizedEOF { ... }
//     ┌─ "/tmp/.../bad.circom":1:1
//     │
//   1 │ pragma circom 2.0.0;
//     │ ^ here
// Patterns ordered most-specific first.

interface ErrorPattern {
  regex: RegExp;
  category: CompileError['category'];
  /** Extract location from match groups */
  extractLocation?: (match: RegExpMatchArray) => Partial<Pick<CompileError, 'file' | 'line' | 'column'>>;
}

const PATTERNS: ErrorPattern[] = [
  // Syntax errors (parser/lexer): error[P\d+]: ...
  // followed by a location block: ┌─ "path":line:col
  {
    regex: /error\[P(\d+)\]:[\s\S]*?┌─\s*"([^"]+)":(\d+):(\d+)/,
    category: 'syntax',
    extractLocation: (m) => ({ file: m[2], line: Number(m[3]), column: Number(m[4]) }),
  },
  // Type/semantic errors: error[T\d+]: ...
  {
    regex: /error\[T(\d+)\]:[\s\S]*?┌─\s*"([^"]+)":(\d+):(\d+)/,
    category: 'semantic',
    extractLocation: (m) => ({ file: m[2], line: Number(m[3]), column: Number(m[4]) }),
  },
  // Syntax errors without location block
  {
    regex: /error\[P\d+\]/,
    category: 'syntax',
  },
  // Semantic errors without location block
  {
    regex: /error\[T\d+\]/,
    category: 'semantic',
  },
  // Unsupported: include statements (we don't support multi-file)
  {
    regex: /include\s+"[^"]+"/i,
    category: 'unsupported',
  },
  // Generic error: prefix fallback
  {
    regex: /error:/i,
    category: 'internal',
  },
];

/**
 * Parse raw compiler stderr into structured CompileError[].
 *
 * Why: Separating this logic means the API route and tests are decoupled from
 * the raw string format. Each pattern maps to an actionable error category.
 *
 * How: Try each pattern in order. On first match, extract message + location.
 * If no pattern matches, emit a single 'internal' error with the raw stderr.
 */
export function mapCompileErrors(stderr: string): CompileError[] {
  if (!stderr || !stderr.trim()) return [];

  for (const { regex, category, extractLocation } of PATTERNS) {
    const match = stderr.match(regex);
    if (match) {
      const location = extractLocation ? extractLocation(match) : {};
      // Extract the first "error[...]:" line as the message
      const messageLine = stderr.split('\n').find((l) => /error/i.test(l)) ?? stderr;
      return [
        {
          message: messageLine.trim(),
          category,
          ...location,
        },
      ];
    }
  }

  // Fallback: return the whole stderr as an internal error
  return [
    {
      message: stderr.trim(),
      category: 'internal',
    },
  ];
}

/**
 * Build a single 'validation' CompileError for pre-compilation checks.
 */
export function makeValidationError(message: string): CompileError {
  return { message, category: 'validation' };
}

/**
 * Parse constraint count from circom stdout.
 *
 * Circom outputs a line like: "template instances: 1, non linear constraints: 0, linear constraints: 1"
 * or: "Total number of constraints: 42"
 */
export function parseConstraintCount(stdout: string): number {
  const patterns = [
    /non[- ]linear constraints:\s*(\d+)/i,
    /total number of constraints:\s*(\d+)/i,
    /constraints:\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = stdout.match(p);
    if (m) return Number(m[1]);
  }
  return 0;
}

/**
 * Parse wire count from circom stdout, if present.
 */
export function parseWireCount(stdout: string): number | undefined {
  const m = stdout.match(/total wires:\s*(\d+)/i);
  return m ? Number(m[1]) : undefined;
}

/**
 * Normalize raw compiler output into a stable CircomCompileResult.
 *
 * Why: Downstream features (VK generation, calldata) depend on a stable contract,
 * not on raw stdout strings.
 */
export function normalizeCompileOutput(raw: RawCompileOutput) {
  const warnings = raw.stdout
    .split('\n')
    .filter((l) => /warning/i.test(l))
    .map((l) => l.trim());

  return {
    constraintCount: parseConstraintCount(raw.stdout),
    wireCount: parseWireCount(raw.stdout),
    warnings,
  };
}
