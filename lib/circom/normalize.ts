import { CompileError, RawCompileOutput } from './types';

// ─── Known circom stderr patterns ─────────────────────────────────────────────
// These are pattern-matched against real circom stderr (populated in Feature 02).
// Patterns are ordered most-specific first.

interface ErrorPattern {
  regex: RegExp;
  category: CompileError['category'];
  /** Extract location from match groups: [file, line, column] */
  extractLocation?: (match: RegExpMatchArray) => Partial<Pick<CompileError, 'file' | 'line' | 'column'>>;
}

const PATTERNS: ErrorPattern[] = [
  // circom syntax error: "error[P1002]: ... at filename:line:col"
  {
    regex: /error\[P\d+\]:.*?(?:\n.*?)*?-->\s*(.+?):(\d+):(\d+)/i,
    category: 'syntax',
    extractLocation: (m) => ({ file: m[1], line: Number(m[2]), column: Number(m[3]) }),
  },
  // circom type/semantic error: "error[T...]: ..."
  {
    regex: /error\[T\d+\]:/i,
    category: 'semantic',
  },
  // include/import not supported check
  {
    regex: /include\s+"[^"]+"/i,
    category: 'unsupported',
  },
  // generic "error:" prefix fallback
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
    /non linear constraints:\s*(\d+)/i,
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
