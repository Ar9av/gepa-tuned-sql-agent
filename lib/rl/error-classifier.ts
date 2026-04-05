import { ErrorClass } from './types'

// Severity ordering: lower = less severe (closer to correct).
// Used by the grader for reward shaping — if the error class moves
// toward lower severity, the agent gets partial credit.
const SEVERITY: Record<ErrorClass, number> = {
  [ErrorClass.OTHER]:             5,  // unknown — worst, no signal
  [ErrorClass.SYNTAX_ERROR]:      4,  // can't even parse
  [ErrorClass.NO_SUCH_FUNCTION]:  3,  // parsed but wrong function
  [ErrorClass.NO_SUCH_TABLE]:     3,  // parsed but wrong table
  [ErrorClass.DATATYPE_MISMATCH]: 2,  // structure OK, types wrong
  [ErrorClass.AGGREGATION_ERROR]: 2,  // structure OK, grouping wrong
  [ErrorClass.NO_SUCH_COLUMN]:    1,  // almost right, just wrong column
  [ErrorClass.AMBIGUOUS_COLUMN]:  1,  // right column, needs qualification
}

export function errorSeverity(errorClass: ErrorClass): number {
  return SEVERITY[errorClass]
}

/**
 * Classify a raw SQLite error message into one of 8 canonical classes.
 * Regex patterns are ordered most-specific-first to avoid false matches.
 */
export function classifyError(errorMessage: string): ErrorClass {
  const msg = errorMessage.toLowerCase()

  // Column-level errors
  if (msg.includes('no such column'))    return ErrorClass.NO_SUCH_COLUMN
  if (msg.includes('ambiguous column'))  return ErrorClass.AMBIGUOUS_COLUMN

  // Table-level errors
  if (msg.includes('no such table'))     return ErrorClass.NO_SUCH_TABLE

  // Function errors
  if (msg.includes('no such function'))  return ErrorClass.NO_SUCH_FUNCTION

  // Aggregation / GROUP BY
  if (
    msg.includes('not an aggregate') ||
    msg.includes('misuse of aggregate') ||
    (msg.includes('group by') && msg.includes('must appear')) ||
    msg.includes('must be an aggregate')
  ) {
    return ErrorClass.AGGREGATION_ERROR
  }

  // Syntax errors (broad — must come after more specific patterns)
  if (msg.includes('syntax error') || /near\s+"/.test(msg)) {
    return ErrorClass.SYNTAX_ERROR
  }

  // Type errors
  if (msg.includes('datatype mismatch') || msg.includes('type mismatch')) {
    return ErrorClass.DATATYPE_MISMATCH
  }

  return ErrorClass.OTHER
}

/**
 * Extract the offending token from a SQLite error message.
 * Returns null if no specific token can be identified.
 */
export function extractOffendingToken(errorMessage: string): string | null {
  // "no such column: X"
  const colMatch = errorMessage.match(/no such column:\s*(\S+)/i)
  if (colMatch) return colMatch[1]

  // "no such table: X"
  const tableMatch = errorMessage.match(/no such table:\s*(\S+)/i)
  if (tableMatch) return tableMatch[1]

  // 'near "X": syntax error'
  const nearMatch = errorMessage.match(/near\s+"([^"]+)"/i)
  if (nearMatch) return nearMatch[1]

  // "no such function: X"
  const funcMatch = errorMessage.match(/no such function:\s*(\S+)/i)
  if (funcMatch) return funcMatch[1]

  return null
}
